// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../apps/web/src/App.js";
import { EventTimeline } from "../../apps/web/src/replay/EventTimeline.js";
import {
  batchBonusExploitActions,
  createReplayFrames,
  exploitActions,
  patchPolicies,
  replayFrames,
  startingPolicy,
  startingPolicySourceText,
} from "../../apps/web/src/replay-data.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderBottle(view: "attack" | "replay" | "validate" = "attack") {
  render(<App />);
  fireEvent.click(screen.getByRole("tab", { name: /Bottle Return lab/ }));
  if (view !== "attack") {
    fireEvent.click(screen.getByRole("tab", { name: view === "replay" ? /What went wrong/ : /Best repair/ }));
  }
}

describe("offline replay game", () => {
  it("supports standard arrow-key navigation in every tab list", async () => {
    const user = userEvent.setup();
    render(<App />);

    const failureTab = screen.getByRole("tab", { name: /What went wrong/ });
    failureTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Best repair/ }).getAttribute("aria-selected")).toBe("true");

    const commerceTab = screen.getByRole("tab", { name: /Commerce audit/ });
    commerceTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Bottle Return lab/ }).getAttribute("aria-selected")).toBe("true");

    const ruleTab = screen.getByRole("tab", { name: /Your rule/ });
    ruleTab.focus();
    await user.keyboard("{ArrowRight}");
    const replayTab = screen.getByRole("tab", { name: /What went wrong/ });
    expect(replayTab.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(replayTab, { key: "Home", ctrlKey: true });
    expect(replayTab.getAttribute("aria-selected")).toBe("true");
  });

  it("labels timeline payouts with the host-computed amount", () => {
    render(
      <EventTimeline
        frames={createReplayFrames(patchPolicies.batchVulnerable, batchBonusExploitActions)}
        activeFrame={0}
        reasoning={null}
        onSelect={() => undefined}
      />,
    );

    expect(screen.getAllByText("+5 payout")).toHaveLength(3);
  });

  it("prefills the executable starting policy without exposing the credit balance", async () => {
    let attackedPolicy: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (url === "/api/health") return Response.json({ liveAgent: { isEnabled: true } });
        if (url === "/api/regressions/evaluate") return Response.json([]);
        if (url === "/api/attacks") {
          attackedPolicy = JSON.parse(String(init?.body)).policy;
          return Response.json(
            {
              runId: null,
              verification: { status: "no_exploit_found_within_budget" },
              usage: { requests: 1, totalTokens: 20, actualUsd: 0.001 },
              report: {
                outcome: "search_completed",
                reason: "Search completed.",
                requestsUsed: 1,
                trialsCompleted: 1,
                actionsTested: 1,
                attemptedTraces: [],
              },
            },
            { status: 201 },
          );
        }
        return Response.json({ error: { message: "not found" } }, { status: 404 });
      }),
    );
    const user = userEvent.setup();
    renderBottle();

    expect((screen.getByLabelText("Reward policy") as HTMLTextAreaElement).value).toBe(
      startingPolicySourceText,
    );
    const runButton = screen.getByRole("button", { name: "Test my rule" });
    await waitFor(() => expect(runButton.hasAttribute("disabled")).toBe(false));
    expect(screen.queryByText(/Meta connected|budget left/)).toBeNull();
    await user.click(runButton);
    await waitFor(() => expect(attackedPolicy).toEqual(startingPolicy));
  });

  it("presents the Bottle Return workflow as three judge-focused steps", async () => {
    const user = userEvent.setup();
    renderBottle();

    expect(screen.getByRole("heading", { level: 1, name: "Fine Print" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Test whether points reflect real recycling." })).toBeTruthy();
    expect(screen.getByText(/Muse searches for ways points can be paid before recycling is proven/i)).toBeTruthy();
    expect(within(screen.getByRole("tablist", { name: "Bottle Return workflow" })).getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByLabelText("Reward paid").textContent).toBe("30");
    expect(screen.getByLabelText("Items recycled").textContent).toBe("0");
    expect(screen.getByRole("button", { name: "Load recorded case" })).toBeTruthy();
    const evidenceDetails = screen.getByText("Show current evidence and limits").closest("details");
    expect(evidenceDetails?.hasAttribute("open")).toBe(false);
    await user.click(screen.getByText("Show current evidence and limits"));
    expect(evidenceDetails?.hasAttribute("open")).toBe(true);
    expect(screen.getByText(/Search budget: up to 12 requests/)).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /What went wrong/ }));
    expect(screen.getByRole("region", { name: "Bottle Return depot" })).toBeTruthy();
    expect(screen.getByLabelText("Paid points").textContent).toBe("30");
    expect(screen.getByLabelText("Actually recycled").textContent).toBe("0");
    expect(screen.getByRole("button", { name: "Replay from start" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Replay position" })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /Best repair/ }));
    expect(screen.getByRole("heading", { name: "Require successful processing" })).toBeTruthy();
    await user.click(screen.getByText("Show technical evidence"));
    expect(screen.getByRole("heading", { name: "Policy Lab" })).toBeTruthy();
    expect(screen.getByText("Scripted fixture")).toBeTruthy();
    expect(screen.getByText("Observed traces, not a safety guarantee.")).toBeTruthy();
  });

  it("keeps the full workflow in the main landmark and exposes the active timeline step", async () => {
    const user = userEvent.setup();
    renderBottle("replay");

    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { name: "Test whether points reflect real recycling." })).toBeTruthy();
    expect(within(main).queryByRole("heading", { name: "Policy Lab" })).toBeNull();

    const firstStep = within(main).getByRole("button", { name: /1.*Agent moved/i });
    await user.click(firstStep);
    expect(firstStep.getAttribute("aria-current")).toBe("step");
  });

  it("jumps to the next payout and keeps useful work separate", async () => {
    const user = userEvent.setup();
    renderBottle("replay");
    fireEvent.change(screen.getByRole("slider", { name: "Replay position" }), { target: { value: "0" } });

    await user.click(screen.getByRole("button", { name: "Jump to next payout" }));

    expect(screen.getByLabelText("Paid points").textContent).toBe("10");
    expect(screen.getByLabelText("Actually recycled").textContent).toBe("0");
    expect(screen.getByText(/deposit-reward paid 10 points to B1/i)).toBeTruthy();
  });

  it("steps with the keyboard", async () => {
    const user = userEvent.setup();
    renderBottle("replay");
    fireEvent.change(screen.getByRole("slider", { name: "Replay position" }), { target: { value: "0" } });
    const timeline = screen.getByRole("region", { name: "Event timeline" });
    timeline.focus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByLabelText("Current tick").textContent).toBe("1");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByLabelText("Current tick").textContent).toBe("0");
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Pause replay" })).toBeTruthy();
  });

  it("leaves Space available for page scrolling outside the replay timeline", () => {
    renderBottle("replay");
    const space = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });

    document.body.dispatchEvent(space);

    expect(space.defaultPrevented).toBe(false);
    expect(screen.getByRole("button", { name: "Replay from start" })).toBeTruthy();
  });

  it("replays the same trace under a process-only patch without mutating the original", async () => {
    const user = userEvent.setup();
    renderBottle("validate");

    await user.click(screen.getByText("Compare every repair and benchmark"));
    await user.click(screen.getByRole("button", { name: "Try processing-backed repair" }));
    await user.click(screen.getByRole("tab", { name: /What went wrong/ }));
    await user.click(screen.getByRole("button", { name: /11.*Deposit B1/i }));

    expect(screen.getByLabelText("Original paid points").textContent).toBe("30");
    expect(screen.getByLabelText("Patched paid points").textContent).toBe("0");
    expect(screen.getByText("This failure stopped paying.")).toBeTruthy();
    expect(screen.getByLabelText("Current tick").textContent).toBe("11");
    await user.click(screen.getByRole("tab", { name: /Best repair/ }));
    await user.click(screen.getByText("Show technical evidence"));
    expect(screen.getByRole("row", { name: /Trigger deposit process/i })).toBeTruthy();
    expect(screen.getByRole("row", { name: /Eligibility required false true/i })).toBeTruthy();
    expect(screen.getByText("Server exports include the exact policy, actions, provenance, limits, and integrity hashes for offline replay.")).toBeTruthy();

    const { rewardLedger: originalLedger, ...originalPhysicalState } = replayFrames[11]!.state;
    const { rewardLedger: patchedLedger, ...patchedPhysicalState } =
      createReplayFrames(patchPolicies.eligibleProcessing)[11]!.state;
    expect(patchedPhysicalState).toEqual(originalPhysicalState);
    expect(patchedLedger).not.toBe(originalLedger);
  });

  it("shows the failed first fix and stronger patch as explicit regression evidence", async () => {
    const user = userEvent.setup();
    renderBottle("validate");
    await user.click(screen.getByText("Compare every repair and benchmark"));

    expect(screen.getByRole("heading", { name: "Repair scorecard" })).toBeTruthy();
    expect(screen.getByLabelText("Active honest workflows preserved").textContent).toBe("3 / 3");
    expect(screen.getByLabelText("Active known failures blocked").textContent).toBe("0 / 3");

    await user.click(screen.getByRole("button", { name: "Try once-per-item repair" }));

    expect(screen.getByLabelText("Selected repair known failures blocked").textContent).toBe("1 / 3");
    expect(screen.getByText("No duplicate payout")).toBeTruthy();
    expect(screen.getByText("Ineligible deposit paid 10 points")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Try processing-backed repair" }));

    expect(screen.getByLabelText("Selected repair known failures blocked").textContent).toBe("3 / 3");
    expect(screen.getByText("No duplicate payout")).toBeTruthy();
    expect(screen.getAllByText("Paid nothing")).toHaveLength(2);
  });

  it("shows the designed batch interaction and targets either policy for Muse", async () => {
    const user = userEvent.setup();
    renderBottle("validate");
    await user.click(screen.getByText("Compare every repair and benchmark"));

    expect(screen.getByRole("heading", { name: "Can a transient hopper state impersonate completed work?" })).toBeTruthy();
    expect(screen.getByText("15 test points · 0 useful items")).toBeTruthy();
    expect(screen.getByText("0 test points · 0 useful items")).toBeTruthy();
    expect(screen.getAllByText("Honest 3: 35 points · honest 6: 70")).toHaveLength(2);

    const vulnerable = screen.getByRole("button", { name: "Test hopper-count rule" });
    await user.click(vulnerable);
    expect(vulnerable.getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("tab", { name: /Your rule/ }));
    expect(screen.getByRole("button", { name: "Recheck hopper-count batch benchmark" })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /Best repair/ }));
    const patched = screen.getByRole("button", { name: "Test receipt-backed repair" });
    await user.click(patched);
    expect(patched.getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("tab", { name: /Your rule/ }));
    expect(screen.getByRole("button", { name: "Recheck receipt-backed batch repair" })).toBeTruthy();
  });

  it("runs a live Meta attack and loads the host-verified trace", async () => {
    let attackedPolicy: unknown;
    let regressionSaved = false;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/health") {
        return Response.json({
          status: "ok",
          liveAgent: { isEnabled: true, reasons: [] },
          meta: { isConfigured: true, modelId: "muse-spark-1.3" },
        });
      }
      if (url === "/api/usage") {
        return Response.json({ availableAppUsd: 9.8, settledUsd: 0.2 });
      }
      if (url === "/api/attacks") {
        attackedPolicy = JSON.parse(String(init?.body)).policy;
        return Response.json(
          {
            searchId: "web-test",
            runId: "verified-run",
            provenance: "live_model",
            modelId: "muse-spark-1.3",
            replayed: false,
            verification: {
              status: "exploit_verified",
              totalReward: 30,
              usefulItems: 0,
              excessReward: 30,
              requestsUsed: 2,
            },
            turns: [
              {
                sequence: 1,
                strategySummary: "Test repeated deposits.",
                toolNames: ["inspect"],
              },
            ],
            usage: { requests: 2, totalTokens: 500, actualUsd: 0.001 },
            report: {
              outcome: "verified_exploit",
              reason: "Host replay verified 30 unintended reward points.",
              requestsUsed: 2,
              trialsCompleted: 1,
              actionsTested: 12,
              attemptedTraces: [
                {
                  request: 2,
                  trial: 1,
                  kind: "candidate",
                  hypothesis: "Repeated deposits may pay before useful processing.",
                  actions: exploitActions,
                },
              ],
            },
          },
          { status: 201 },
        );
      }
      if (url === "/api/regressions/evaluate") {
        return Response.json(
          regressionSaved
            ? [
                {
                  id: "saved-case",
                  label: "once-per-item patch exploit",
                  expectedExcessReward: 30,
                  blocked: true,
                  current: { totalReward: 10, usefulItems: 0, excessReward: 0 },
                },
              ]
            : [],
        );
      }
      if (url === "/api/regressions") {
        regressionSaved = true;
        return Response.json(
          {
            replayed: false,
            regressionCase: { id: "saved-case", label: "once-per-item patch exploit" },
          },
          { status: 201 },
        );
      }
      if (url === "/api/runs/verified-run/export") {
        return Response.json({ actions: exploitActions });
      }
      return Response.json({ error: { message: "not found" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderBottle();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Test my rule" }).hasAttribute("disabled")).toBe(false),
    );
    await user.click(screen.getByRole("tab", { name: /Best repair/ }));
    await user.click(screen.getByText("Compare every repair and benchmark"));
    await user.click(screen.getByRole("button", { name: "Try once-per-item repair" }));
    await user.click(screen.getByRole("tab", { name: /Your rule/ }));
    await user.click(screen.getByRole("button", { name: "Recheck once-per-item repair" }));

    const latestAttempt = await screen.findByRole("status", { name: "Latest test result" });
    expect(within(latestAttempt).getByText("Failure confirmed")).toBeTruthy();
    expect(attackedPolicy).toEqual(patchPolicies.oncePerItem);
    await user.click(screen.getByText("Show Muse test activity"));
    expect(screen.getByText("Test repeated deposits.")).toBeTruthy();
    expect((screen.getByLabelText("Reward policy") as HTMLTextAreaElement).value).toBe("Pay only once per item when it is deposited.");

    await user.click(screen.getByRole("button", { name: "Save as permanent check" }));
    expect(await screen.findByText("Saved permanent check: once-per-item patch failure.")).toBeTruthy();
    await user.click(screen.getByText("Show saved checks"));
    const savedCases = screen.getByRole("region", { name: "Saved checks" });
    expect(within(savedCases).getByText("Passed")).toBeTruthy();
    expect(within(savedCases).getByText("Expected 30 extra · now 0")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /What went wrong/ }));
    await user.click(screen.getByText("Show AI reasoning and simulator evidence"));
    const reasoning = screen.getByRole("group", { name: "AI reasoning and simulator evidence" });
    expect(within(reasoning).getByText("AI test idea")).toBeTruthy();
    expect(within(reasoning).getByText("Repeated deposits may pay before useful processing.")).toBeTruthy();
    expect(within(reasoning).getByText("Simulator result")).toBeTruthy();
    expect(within(reasoning).getByText("30 reward points · 0 useful items")).toBeTruthy();
    expect(within(reasoning).getByText("Verdict")).toBeTruthy();
    expect(screen.getByLabelText("Replay position").getAttribute("max")).toBe("12");

    await user.click(screen.getByRole("tab", { name: /Best repair/ }));
    await user.click(screen.getByText("Show technical evidence"));
    expect(screen.getByText("Live model")).toBeTruthy();
    expect(screen.getByText("muse-spark-1.3")).toBeTruthy();
    const validation = screen.getByRole("tabpanel", { name: /Best repair/i });
    await user.click(screen.getByText("Compare every repair and benchmark"));
    expect(within(validation).getByText("Pay only once per item when it is deposited.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try once-per-item repair" }).getAttribute("aria-pressed")).toBe("false");
    await user.click(screen.getByRole("tab", { name: /Your rule/ }));
    expect(within(screen.getByRole("status", { name: "Latest test result" })).getByText("Failure confirmed")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /Commerce audit/ }));
    await user.click(screen.getByRole("tab", { name: /Bottle Return lab/ }));
    expect(within(screen.getByRole("status", { name: "Latest test result" })).getByText("Failure confirmed")).toBeTruthy();
  });

  it("explains an unsuccessful live attempt without replacing the loaded replay", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/health") {
        return Response.json({ liveAgent: { isEnabled: true } });
      }
      if (url === "/api/usage") {
        return Response.json({ availableAppUsd: 9.8 });
      }
      if (url === "/api/attacks") {
        return Response.json(
          {
            searchId: "completed-search",
            runId: null,
            provenance: "live_model",
            modelId: "muse-spark-1.3",
            replayed: false,
            verification: {
              status: "no_exploit_found_within_budget",
              totalReward: 0,
              usefulItems: 0,
              requestsUsed: 4,
            },
            turns: [{ sequence: 1, strategySummary: "Test batch eligibility.", toolNames: ["act"] }],
            usage: { requests: 4, totalTokens: 800, actualUsd: 0.002 },
            report: {
              outcome: "search_completed",
              reason: "The bounded search completed; no exploit was found within the stated budget.",
              requestsUsed: 4,
              trialsCompleted: 2,
              actionsTested: 7,
              attemptedTraces: [
                {
                  request: 1,
                  trial: 1,
                  kind: "trial",
                  hypothesis: "Test batch eligibility.",
                  actions: [{ type: "wait" }, { type: "finish" }],
                },
              ],
            },
          },
          { status: 201 },
        );
      }
      return Response.json({ error: { message: "not found" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderBottle();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Test my rule" }).hasAttribute("disabled")).toBe(false),
    );
    await user.click(screen.getByRole("button", { name: "Load recorded case" }));
    await user.click(screen.getByRole("tab", { name: /Best repair/ }));
    await user.click(screen.getByText("Compare every repair and benchmark"));
    await user.click(screen.getByRole("button", { name: "Try processing-backed repair" }));
    await user.click(screen.getByRole("tab", { name: /Your rule/ }));
    await user.click(screen.getByRole("button", { name: "Recheck processing-backed repair" }));

    const attempt = await screen.findByRole("status", { name: "Latest test result" });
    expect(within(attempt).getByText("No failure found in this attempt")).toBeTruthy();
    expect(within(attempt).getByText("processing-backed repair", { selector: "span" })).toBeTruthy();
    expect(within(attempt).getByText("The bounded search completed; no failure was found within the stated budget.")).toBeTruthy();
    await user.click(within(attempt).getByText("Show test details"));
    expect(within(attempt).getByText("Live Meta test")).toBeTruthy();
    expect(within(attempt).getByText("4 requests")).toBeTruthy();
    expect(within(attempt).getByText("2 trials")).toBeTruthy();
    expect(within(attempt).getByText("7 actions")).toBeTruthy();
    expect(within(attempt).getByText("Test batch eligibility.")).toBeTruthy();
    expect(within(attempt).getByText("wait → finish")).toBeTruthy();

    await user.click(screen.getByText("Show current evidence and limits"));
    const loadedEvidence = screen.getByRole("region", { name: "Current evidence and limits" });
    expect(within(loadedEvidence).getByText("Failure independently confirmed")).toBeTruthy();
  });

  it("interprets and explicitly activates a natural-language policy", async () => {
    const aluminiumPolicy = {
      schemaVersion: 1 as const,
      clauses: [
        {
          id: "aluminium-processing",
          enabled: true,
          trigger: "process" as const,
          points: 7,
          eligibleOnly: false,
          materials: ["aluminium"] as const,
          repetition: "once_per_item" as const,
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/health") {
        return Response.json({ liveAgent: { isEnabled: true } });
      }
      if (url === "/api/usage") {
        return Response.json({ availableAppUsd: 9.8 });
      }
      if (url === "/api/policies/translate") {
        return Response.json({
          interpretation: {
            status: "candidate",
            reason: "Pays seven points once after aluminium processing.",
            policy: aluminiumPolicy,
          },
          usage: { actualUsd: 0.001 },
        });
      }
      return Response.json({ error: { message: "not found" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderBottle();
    const sourceText = "Pay 7 points once per aluminium item, only after it is successfully processed. Depositing an item earns no points.";

    await user.clear(screen.getByLabelText("Reward policy"));
    await user.type(screen.getByLabelText("Reward policy"), sourceText);
    await user.click(screen.getByRole("button", { name: "Understand this rule" }));

    expect(await screen.findByText("Pays seven points once after aluminium processing.")).toBeTruthy();
    await user.click(screen.getByText("Show technical rule mapping"));
    expect(screen.getByText("Reward trigger")).toBeTruthy();
    expect(screen.getByText("Paid materials")).toBeTruthy();
    expect(screen.getByText("Eligibility required")).toBeTruthy();
    expect(screen.getByText("Repeat limit")).toBeTruthy();
    expect(screen.getByText("Successful processing required")).toBeTruthy();
    expect(screen.getByText("aluminium")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use this rule" }));
    expect((screen.getByLabelText("Reward policy") as HTMLTextAreaElement).value).toBe(sourceText);
    expect(screen.getByLabelText("Reward paid").textContent).toBe("0");
    expect(screen.getByLabelText("Items recycled").textContent).toBe("0");
    await user.click(screen.getByRole("tab", { name: /Best repair/i }));
    await user.click(screen.getByText("Compare every repair and benchmark"));
    const validation = screen.getByRole("tabpanel", { name: /Best repair/i });
    expect(within(validation).getByText(sourceText)).toBeTruthy();
    const activePolicy = screen.getByRole("heading", { name: "Your active rule" }).closest("section");
    expect(activePolicy).not.toBeNull();
    expect(within(activePolicy!).getByText("process", { selector: "dd" })).toBeTruthy();
    expect(within(activePolicy!).getByText("aluminium items", { selector: "dd" })).toBeTruthy();
    expect(within(activePolicy!).getByText("+7", { selector: "dd" })).toBeTruthy();
    expect(screen.getAllByText("Expected 60 · actual 21")).toHaveLength(3);
    expect(screen.getByText(/A different policy is not invalid/)).toBeTruthy();
  });

  it("discards a translation response after the policy draft changes", async () => {
    let resolveTranslation!: (response: Response) => void;
    const translation = new Promise<Response>((resolve) => {
      resolveTranslation = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url === "/api/health") return Response.json({ liveAgent: { isEnabled: true } });
        if (url === "/api/regressions/evaluate") return Response.json([]);
        if (url === "/api/policies/translate") return translation;
        return Response.json({ error: { message: "not found" } }, { status: 404 });
      }),
    );
    const user = userEvent.setup();
    renderBottle();
    const input = screen.getByLabelText("Reward policy");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Understand this rule" }).hasAttribute("disabled")).toBe(false),
    );
    await user.clear(input);
    await user.type(input, "Pay seven points after aluminium processing.");
    await user.click(screen.getByRole("button", { name: "Understand this rule" }));
    await user.clear(input);
    await user.type(input, "Pay three points after plastic processing.");
    resolveTranslation(
      Response.json({
        interpretation: {
          status: "candidate",
          reason: "Pays seven points after aluminium processing.",
          policy: {
            schemaVersion: 1,
            clauses: [
              {
                id: "aluminium-processing",
                enabled: true,
                trigger: "process",
                points: 7,
                eligibleOnly: true,
                materials: ["aluminium"],
                repetition: "once_per_item",
              },
            ],
          },
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Understand this rule" }).hasAttribute("disabled")).toBe(false),
    );
    expect(screen.queryByRole("button", { name: "Use this rule" })).toBeNull();
    expect((input as HTMLTextAreaElement).value).toBe("Pay three points after plastic processing.");
  });
});
