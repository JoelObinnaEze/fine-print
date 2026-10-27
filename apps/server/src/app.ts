import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  BudgetServiceError,
  emptyBudgetUsage,
  type BudgetService,
} from "./budget/service.js";
import { readServerConfig, type ServerConfig } from "./config.js";
import {
  MetaPolicyTranslatorError,
  policyTranslationRequestSchema,
  type MetaPolicyTranslator,
} from "./providers/meta.js";
import { createRunSchema, idempotencyKeySchema, runIdSchema } from "./runs/contracts.js";
import { RunService, RunServiceError, type RunEvent, type RunStatus } from "./runs/service.js";

const maxBodyBytes = 64 * 1024;
const terminalStatuses = new Set<RunStatus>([
  "completed",
  "cancelled",
  "interrupted",
  "infrastructure_error",
]);

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendError(response: ServerResponse, status: number, code: string, message: string, details?: unknown): void {
  sendJson(response, status, {
    error: details === undefined ? { code, message } : { code, message, details },
  });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  let text = "";
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size <= maxBodyBytes) text += chunk.toString();
  }
  if (size > maxBodyBytes) {
    throw new RequestError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 65536 bytes.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new RequestError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function validatedRunId(value: string): string {
  const result = runIdSchema.safeParse(value);
  if (!result.success) throw new RequestError(400, "INVALID_RUN_ID", "Run ID is invalid.");
  return result.data;
}

function lastEventSequence(request: IncomingMessage): number {
  const value = request.headers["last-event-id"];
  if (value === undefined) return 0;
  if (Array.isArray(value) || !/^\d+$/.test(value)) {
    throw new RequestError(400, "INVALID_EVENT_ID", "Last-Event-ID must be a non-negative integer.");
  }
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence)) {
    throw new RequestError(400, "INVALID_EVENT_ID", "Last-Event-ID must be a non-negative integer.");
  }
  return sequence;
}

function writeEvent(response: ServerResponse, event: RunEvent): void {
  response.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function streamEvents(request: IncomingMessage, response: ServerResponse, service: RunService, runId: string): void {
  const after = lastEventSequence(request);
  const run = service.get(runId);
  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });
  for (const event of service.eventsAfter(runId, after)) writeEvent(response, event);
  if (terminalStatuses.has(run.status)) {
    response.end();
    return;
  }

  const unsubscribe = service.subscribe(runId, (event) => {
    writeEvent(response, event);
    if (event.type.startsWith("run.") && terminalStatuses.has(event.type.slice(4) as RunStatus)) {
      unsubscribe();
      response.end();
    }
  });
  request.once("close", unsubscribe);
}

interface ServerOptions {
  readonly config: ServerConfig;
  readonly budget: BudgetService;
  readonly translator?: MetaPolicyTranslator;
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  service: RunService,
  config: ServerConfig,
  budget: BudgetService | undefined,
  translator: MetaPolicyTranslator | undefined,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      status: "ok",
      liveAgent: config.liveAgent,
      meta: config.provider
        ? { isConfigured: true, baseUrl: config.provider.baseUrl, modelId: config.provider.modelId }
        : { isConfigured: false, baseUrl: null, modelId: null },
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/usage") {
    sendJson(response, 200, budget?.getUsage() ?? emptyBudgetUsage(config));
    return;
  }

  if (method === "POST" && url.pathname === "/api/policies/translate") {
    if (!config.liveAgent.isEnabled || !translator) {
      throw new RequestError(503, "LIVE_TRANSLATION_DISABLED", "Live translation is unavailable.");
    }
    const keyResult = idempotencyKeySchema.safeParse(request.headers["idempotency-key"]);
    if (!keyResult.success) {
      throw new RequestError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key is required and invalid.");
    }
    const inputResult = policyTranslationRequestSchema.safeParse(await readJson(request));
    if (!inputResult.success) {
      throw new RequestError(
        422,
        "VALIDATION_ERROR",
        "Translation request is invalid.",
        inputResult.error.issues,
      );
    }
    sendJson(response, 200, await translator.translate(inputResult.data.text, keyResult.data));
    return;
  }

  if (method === "POST" && url.pathname === "/api/runs") {
    const keyResult = idempotencyKeySchema.safeParse(request.headers["idempotency-key"]);
    if (!keyResult.success) {
      throw new RequestError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key is required and invalid.");
    }
    const inputResult = createRunSchema.safeParse(await readJson(request));
    if (!inputResult.success) {
      throw new RequestError(422, "VALIDATION_ERROR", "Run request is invalid.", inputResult.error.issues);
    }
    const result = service.create(inputResult.data, keyResult.data);
    sendJson(response, result.replayed ? 200 : 201, result.run);
    return;
  }

  const eventsMatch = /^\/api\/runs\/([^/]+)\/events$/.exec(url.pathname);
  if (method === "GET" && eventsMatch) {
    streamEvents(request, response, service, validatedRunId(eventsMatch[1]!));
    return;
  }

  const cancelMatch = /^\/api\/runs\/([^/]+)\/cancel$/.exec(url.pathname);
  if (method === "POST" && cancelMatch) {
    sendJson(response, 200, service.cancel(validatedRunId(cancelMatch[1]!)));
    return;
  }

  const runMatch = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
  if (method === "GET" && runMatch) {
    sendJson(response, 200, service.get(validatedRunId(runMatch[1]!)));
    return;
  }

  throw new RequestError(404, "NOT_FOUND", "Route was not found.");
}

export function createRunServer(service = new RunService(), options?: ServerOptions) {
  const config = options?.config ?? readServerConfig({});
  return createServer((request, response) => {
    response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    void handle(request, response, service, config, options?.budget, options?.translator).catch((error: unknown) => {
      if (error instanceof RequestError) {
        sendError(response, error.status, error.code, error.message, error.details);
      } else if (error instanceof RunServiceError) {
        const status = error.code === "RUN_NOT_FOUND" ? 404 : 422;
        sendError(response, status, error.code, error.message);
      } else if (error instanceof MetaPolicyTranslatorError) {
        const status =
          error.code === "TRANSLATION_ALREADY_ATTEMPTED"
            ? 409
            : error.code === "PROVIDER_BUSY"
              ? 429
              : error.code === "PROVIDER_REJECTED" ||
                  error.code === "PROVIDER_OUTPUT_INVALID" ||
                  error.code === "PROVIDER_OUTCOME_UNKNOWN"
              ? 502
              : 422;
        sendError(response, status, error.code, error.message);
      } else if (error instanceof BudgetServiceError) {
        const status =
          error.code === "LIVE_DISABLED"
            ? 503
            : error.code === "BUDGET_EXCEEDED"
              ? 402
              : 422;
        sendError(response, status, error.code, error.message);
      } else {
        sendError(response, 500, "INTERNAL_ERROR", "Internal server error.");
      }
    });
  });
}
