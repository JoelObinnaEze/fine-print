// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommerceWorkbench } from "../../apps/web/src/commerce/CommerceWorkbench.js";
import { recordedCommerceInvestigation } from "../../apps/web/src/commerce/recorded-investigation.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("commerce incentive workbench", () => {
  it("opens on the verified exploit and keeps the rest one tab away", async () => {
    const user = userEvent.setup();
    render(<CommerceWorkbench />);

    expect(screen.getByRole("heading", { name: "Find where rewards detach from value." })).toBeTruthy();
    expect(screen.getByText("Recorded Muse investigation · host replayed")).toBeTruthy();
    expect(screen.queryByLabelText("Actual reward rule")).toBeNull();

    const counterexample = screen.getByRole("region", { name: "Verified counterexample" });
    expect(within(counterexample).getByText("The reward survives after the value disappears.")).toBeTruthy();
    expect(within(counterexample).getByText("Model hypothesis · unverified wording")).toBeTruthy();
    expect(within(counterexample).getByText("3 proposed → 3 required")).toBeTruthy();
    expect(within(counterexample).getByText("A referred B.")).toBeTruthy();
    expect(within(counterexample).getByText("B bought P1 for $20.")).toBeTruthy();
    expect(within(counterexample).getByText("B refunded P1.")).toBeTruthy();
    expect(within(counterexample).getByText(/\$20 became spendable/)).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /Policy/ }));
    expect(screen.getByLabelText("Actual reward rule")).toBeTruthy();
    expect(screen.getByLabelText("Minimum retained revenue")).toBeTruthy();
    expect(screen.getByLabelText("Customer promise to preserve")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What the simulator can enforce" })).toBeTruthy();
    expect(screen.getByText("$10 to each account")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /Audience/ }));
    const population = screen.getByRole("region", { name: "Participant population" });
    expect(within(population).getByText("Ordinary customers")).toBeTruthy();
    expect(within(population).getByText("Bargain hunters")).toBeTruthy();
    expect(within(population).getByText("Coordinated adversaries")).toBeTruthy();
    expect(within(population).getByText(/Simulation under stated assumptions/)).toBeTruthy();
  });

  it("ranks competing repairs by owner priority and fresh-tests the selection", async () => {
    const user = userEvent.setup();
    render(<CommerceWorkbench />);

    await user.click(screen.getByRole("tab", { name: /Repairs/ }));
    await user.click(screen.getByRole("button", { name: "simple operations" }));
    const recommendation = screen.getByRole("region", { name: "Recommended design" });
    expect(within(recommendation).getByText("Delay credit until returns close")).toBeTruthy();

    const candidate = screen.getAllByRole("article").find((article) =>
      within(article).queryByRole("heading", { name: "Delay credit until returns close" }),
    );
    expect(candidate).toBeTruthy();
    await user.click(within(candidate!).getByRole("button", { name: "Replay known attack" }));
    const retest = screen.getByRole("status", { name: "Fresh repair test" });
    expect(within(retest).getByText("Known trace blocked")).toBeTruthy();
    expect(within(retest).getByText("$0 unintended")).toBeTruthy();
    expect(within(retest).getByText("$20 honest reward")).toBeTruthy();
    expect(within(retest).getByText("30 day delay")).toBeTruthy();
  });

  it("sends user policy and intended outcome separately and exposes unsupported conditions", async () => {
    let submitted: unknown;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/health") {
        return Response.json({ liveAgent: { isEnabled: true } });
      }
      if (url === "/api/usage") {
        return Response.json({ availableAppUsd: 8.5 });
      }
      if (url === "/api/commerce/investigations") {
        submitted = JSON.parse(String(init?.body));
        return Response.json(
          {
            id: "unsupported-1",
            replayed: false,
            modelId: "muse-spark-1.3",
            mapping: {
              status: "unsupported",
              reason: "Geography and device fingerprinting are outside this simulator.",
              policy: null,
              supportedClauses: ["$10 reward"],
              unsupportedConditions: ["country eligibility", "device fingerprinting"],
            },
            attack: null,
            candidates: [],
            population: null,
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, actualUsd: 0.001 },
          },
          { status: 201 },
        );
      }
      return Response.json({ error: { message: "not found" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CommerceWorkbench />);

    await user.click(screen.getByRole("tab", { name: /Policy/ }));
    expect(await screen.findByText("Live ready · $8.50 left")).toBeTruthy();
    await user.clear(screen.getByLabelText("Actual reward rule"));
    await user.type(
      screen.getByLabelText("Actual reward rule"),
      "Pay $10 only to customers in Canada using a unique device.",
    );
    await user.clear(screen.getByLabelText("Minimum retained revenue"));
    await user.type(screen.getByLabelText("Minimum retained revenue"), "30");
    await user.clear(screen.getByLabelText("Customer promise to preserve"));
    await user.type(screen.getByLabelText("Customer promise to preserve"), "Keep the $10 reward");
    await user.click(screen.getByRole("button", { name: "Investigate with Muse" }));

    expect(submitted).toEqual({
      sourceText: "Pay $10 only to customers in Canada using a unique device.",
      goal: {
        metric: "retained_revenue",
        minimumUsd: 30,
        description: "Acquire a referred customer who contributes at least $30 in retained revenue.",
      },
      restrictions: ["Keep the $10 reward"],
    });
    expect(await screen.findByText("Needs wider support")).toBeTruthy();
    expect(screen.getByText("country eligibility")).toBeTruthy();
    expect(screen.getByText("device fingerprinting")).toBeTruthy();
    expect(screen.queryByText("Exploit verified")).toBeNull();
  });

  it("reports fresh-test customer outcomes from the attacked policy population", async () => {
    let usageRequests = 0;
    const population = recordedCommerceInvestigation.population!;
    const liveResult = {
      ...recordedCommerceInvestigation,
      provenance: "live" as const,
      population: {
        ...population,
        strategies: population.strategies.map((strategy) =>
          strategy.id === "ordinary"
            ? {
                ...strategy,
                metrics: { ...strategy.metrics, availableRewardUsd: 77, rewardDelayDays: 9 },
              }
            : strategy,
        ),
      },
      candidates: recordedCommerceInvestigation.candidates.map((candidate, index) =>
        index === 0
          ? {
              ...candidate,
              evaluation: {
                ...candidate.evaluation,
                honest: { ...candidate.evaluation.honest, availableRewardUsd: 999 },
              },
            }
          : candidate,
      ),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        if (String(input) === "/api/health") {
          return Response.json({ liveAgent: { isEnabled: true } });
        }
        if (String(input) === "/api/usage") {
          usageRequests += 1;
          return Response.json({ availableAppUsd: usageRequests === 1 ? 8.5 : 8.25 });
        }
        return Response.json(liveResult, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(<CommerceWorkbench />);

    await user.click(screen.getByRole("tab", { name: /Repairs/ }));
    await user.click(screen.getAllByRole("button", { name: "Fresh Muse attack" })[0]!);

    const retest = await screen.findByRole("status", { name: "Fresh repair test" });
    expect(within(retest).getByText("$77 honest reward")).toBeTruthy();
    expect(within(retest).getByText("9 day delay")).toBeTruthy();
    expect(within(retest).queryByText("$999 honest reward")).toBeNull();
    await user.click(screen.getByRole("tab", { name: /Policy/ }));
    expect(await screen.findByText("Live ready · $8.25 left")).toBeTruthy();
  });
});
