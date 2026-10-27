import { describe, expect, it, vi } from "vitest";

import {
  checkMetaCompatibility,
  readMetaCompatibilityConfig,
} from "../../apps/server/src/providers/meta-compatibility.js";

describe("readMetaCompatibilityConfig", () => {
  it("rejects non-Meta endpoints before a request can send the key", () => {
    expect(() =>
      readMetaCompatibilityConfig({
        MODEL_API_KEY: "test-secret",
        META_BASE_URL: "https://example.com/v1",
      }),
    ).toThrow("META_BASE_URL");
  });

  it("rejects surrounding key whitespace before a request", () => {
    expect(() =>
      readMetaCompatibilityConfig({ MODEL_API_KEY: " test-secret " }),
    ).toThrow("whitespace");
  });
});

describe("checkMetaCompatibility", () => {
  it("authenticates, validates the model catalog, and returns no secret", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://api.meta.ai/v1/models");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer test-secret",
      );

      return new Response(
        JSON.stringify({ data: [{ id: "muse-spark-1.3" }, { id: "muse-image" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await checkMetaCompatibility(
      {
        MODEL_API_KEY: "test-secret",
        META_MODEL_ID: "muse-spark-1.3",
      },
      fetchMock,
    );

    expect(result).toEqual({
      endpoint: "https://api.meta.ai/v1",
      modelId: "muse-spark-1.3",
      modelAvailable: true,
      modelCount: 2,
    });
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });

  it("reports HTTP failures without exposing the response body", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response("internal account details", { status: 403 }),
    );

    await expect(
      checkMetaCompatibility({ MODEL_API_KEY: "test-secret" }, fetchMock),
    ).rejects.toThrow("HTTP 403");
    await expect(
      checkMetaCompatibility({ MODEL_API_KEY: "test-secret" }, fetchMock),
    ).rejects.not.toThrow("internal account details");
  });

  it("rejects an oversized model catalog", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response("{}", {
        status: 200,
        headers: {
          "content-length": "1000001",
          "content-type": "application/json",
        },
      }),
    );

    await expect(
      checkMetaCompatibility({ MODEL_API_KEY: "test-secret" }, fetchMock),
    ).rejects.toThrow("exceeded 1 MB");
  });
});
