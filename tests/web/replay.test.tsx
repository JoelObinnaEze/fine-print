// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../apps/web/src/App.js";
import {
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

function renderBottle(view: "attack" | "replay" | "validate" | "inspect" = "attack") {
  render(<App />);
  fireEvent.click(screen.getByRole("tab", { name: /Bottle Return lab/ }));
  if (view !== "attack") {
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${view}`, "i") }));
  }
}

describe("offline replay game", () => {
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
    const runButton = screen.getByRole("button", { name: "Run fresh Muse attack" });
    await waitFor(() => expect(runButton.hasAttribute("disabled")).toBe(false));
    expect(screen.queryByText(/Meta connected|budget left/)).toBeNull();
    await user.click(runButton);
    await waitFor(() => expect(attackedPolicy).toEqual(startingPolicy));
  });

  it("keeps the Bottle Return workflow complete behind four focused views", async () => {
    const user = userEvent.setup();
    renderBottle();

    expect(screen.getByRole("heading", { level: 1, name: "Fine Print" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Can rewards be earned without recycling anything?" })).toBeTruthy();
    expect(screen.getByText("30 points paid. 0 items recycled.")).toBeTruthy();
    expect(screen.getByText(/Search budget: up to 12 requests/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load recorded starting-policy run" })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /^Replay/i }));
    expect(screen.getByRole("region", { name: "Bottle Return depot" })).toBeTruthy();
    expect(screen.getByLabelText("Paid points").textContent).toBe("0");
    expect(screen.getByLabelText("Actually recycled").textContent).toBe("0");
    expect(screen.getByRole("button", { name: "Play replay" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Replay position" })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /^Inspect/i }));
    expect(screen.getByRole("heading", { name: "Policy Lab" })).toBeTruthy();
    expect(screen.getByText("Scripted fixture")).toBeTruthy();
    expect(screen.getByText("Observed traces, not a safety guarantee.")).toBeTruthy();
  });

  it("keeps the full workflow in the main landmark and exposes the active timeline step", async () => {
    const user = userEvent.setup();
    renderBottle("replay");

    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { name: "Can rewards be earned without recycling anything?" })).toBeTruthy();
    expect(within(main).queryByRole("heading", { name: "Policy Lab" })).toBeNull();

    const firstStep = within(main).getByRole("button", { name: /1.*Agent moved/i });
    await user.click(firstStep);
    expect(firstStep.getAttribute("aria-current")).toBe("step");
  });

  it("jumps to the next payout and keeps useful work separate", async () => {
    const user = userEvent.setup();
    renderBottle("replay");

    await user.click(screen.getByRole("button", { name: "Jump to next payout" }));

    expect(screen.getByLabelText("Paid points").textContent).toBe("10");
    expect(screen.getByLabelText("Actually recycled").textContent).toBe("0");
    expect(screen.getByText(/deposit-reward paid 10 points to B1/i)).toBeTruthy();
  });

  it("steps with the keyboard", async () => {
    const user = userEvent.setup();
    renderBottle("replay");
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
    expect(screen.getByRole("button", { name: "Play replay" })).toBeTruthy();
  });

  it("replays the same trace under a process-only patch without mutating the original", async () => {
    const user = userEvent.setup();
    renderBottle("validate");

    await user.click(screen.getByRole("button", { name: "Test eligible-processing patch" }));
    await user.click(screen.getByRole("tab", { name: /^Replay/i }));
    await user.click(screen.getByRole("button", { name: /11.*Deposit B1/i }));

    expect(screen.getByLabelText("Original paid points").textContent).toBe("30");
    expect(screen.getByLabelText("Patched paid points").textContent).toBe("0");
    expect(screen.getByText("This exploit stopped paying.")).toBeTruthy();
    expect(screen.getByLabelText("Current tick").textContent).toBe("11");
    await user.click(screen.getByRole("tab", { name: /^Inspect/i }));
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

    expect(screen.getByRole("heading", { name: "Policy gauntlet" })).toBeTruthy();
    expect(screen.getByLabelText("Active honest workflows preserved").textContent).toBe("3 / 3");
    expect(screen.getByLabelText("Active known failures blocked").textContent).toBe("0 / 3");

    await user.click(screen.getByRole("button", { name: "Test once-per-item patch" }));

    expect(screen.getByLabelText("Selected patch known failures blocked").textContent).toBe("1 / 3");
    expect(screen.getByText("No duplicate payout")).toBeTruthy();
    expect(screen.getByText("Ineligible deposit paid 10 points")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Test eligible-processing patch" }));

    expect(screen.getByLabelText("Selected patch known failures blocked").textContent).toBe("3 / 3");
    expect(screen.getByText("No duplicate payout")).toBeTruthy();
    expect(screen.getAllByText("Paid nothing")).toHaveLength(2);
  });

  it("shows the designed batch interaction and targets either policy for Muse", async () => {
    const user = userEvent.setup();
    renderBottle("validate");

    expect(screen.getByRole("heading", { name: "Can a transient hopper state impersonate completed work?" })).toBeTruthy();
    expect(screen.getByText("15 exploit points · 0 useful items")).toBeTruthy();
    expect(screen.getByText("0 exploit points · 0 useful items")).toBeTruthy();
    expect(screen.getAllByText("Honest 3: 35 points · honest 6: 70")).toHaveLength(2);

    const vulnerable = screen.getByRole("button", { name: "Target vulnerable batch policy" });
    await user.click(vulnerable);
    expect(vulnerable.getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("tab", { name: /^Attack/i }));
    expect(screen.getByRole("button", { name: "Fresh-attack vulnerable batch benchmark" })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /^Validate/i }));
    const patched = screen.getByRole("button", { name: "Target receipt-backed patch" });
    await user.click(patched);
    expect(patched.getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("tab", { name: /^Attack/i }));
    expect(screen.getByRole("button", { name: "Fresh-attack receipt-backed batch patch" })).toBeTruthy();
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
      expect(screen.getByRole("button", { name: "Run fresh Muse attack" }).hasAttribute("disabled")).toBe(false),
    );
    await user.click(screen.getByRole("tab", { name: /^Validate/i }));
    await user.click(screen.getByRole("button", { name: "Test once-per-item patch" }));
    await user.click(screen.getByRole("tab", { name: /^Attack/i }));
    await user.click(screen.getByRole("button", { name: "Fresh-attack once-per-item patch" }));

    expect(await screen.findByText("Exploit verified")).toBeTruthy();
    expect(attackedPolicy).toEqual(patchPolicies.oncePerItem);
    expect(screen.getByText("Test repeated deposits.")).toBeTruthy();
    expect((screen.getByLabelText("Reward policy") as HTMLTextAreaElement).value).toBe("Pay only once per item when it is deposited.");

    await user.click(screen.getByRole("button", { name: "Save as regression case" }));
    expect(await screen.findByText("Saved regression case: once-per-item patch exploit.")).toBeTruthy();
    const savedCases = screen.getByRole("region", { name: "Saved regression cases" });
    expect(within(savedCases).getByText("Blocked")).toBeTruthy();
    expect(within(savedCases).getByText("Expected 30 excess · now 0")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /^Replay/i }));
    const reasoning = screen.getByRole("complementary", { name: "Attack reasoning" });
    expect(within(reasoning).getByText("Model hypothesis")).toBeTruthy();
    expect(within(reasoning).getByText("Repeated deposits may pay before useful processing.")).toBeTruthy();
    expect(within(reasoning).getByText("Host observation")).toBeTruthy();
    expect(within(reasoning).getByText("30 reward points · 0 useful items")).toBeTruthy();
    expect(within(reasoning).getByText("Host verdict")).toBeTruthy();
    expect(screen.getByLabelText("Replay position").getAttribute("max")).toBe("12");

    await user.click(screen.getByRole("tab", { name: /^Inspect/i }));
    expect(screen.getByText("Live model")).toBeTruthy();
    expect(screen.getByText("muse-spark-1.3")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /^Validate/i }));
    const validation = screen.getByRole("tabpanel", { name: /^Validate/i });
    expect(within(validation).getByText("Pay only once per item when it is deposited.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test once-per-item patch" }).getAttribute("aria-pressed")).toBe("false");
    await user.click(screen.getByRole("tab", { name: /^Attack/i }));
    expect(within(screen.getByRole("status", { name: "Latest live attempt" })).getByText("Exploit verified")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /Commerce audit/ }));
    await user.click(screen.getByRole("tab", { name: /Bottle Return lab/ }));
    expect(within(screen.getByRole("status", { name: "Latest live attempt" })).getByText("Exploit verified")).toBeTruthy();
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
      expect(screen.getByRole("button", { name: "Run fresh Muse attack" }).hasAttribute("disabled")).toBe(false),
    );
    await user.click(screen.getByRole("button", { name: "Load recorded starting-policy run" }));
    await user.click(screen.getByRole("tab", { name: /^Validate/i }));
    await user.click(screen.getByRole("button", { name: "Test eligible-processing patch" }));
    await user.click(screen.getByRole("tab", { name: /^Attack/i }));
    await user.click(screen.getByRole("button", { name: "Fresh-attack eligible-processing patch" }));

    const attempt = await screen.findByRole("status", { name: "Latest live attempt" });
    expect(within(attempt).getByText("Search completed")).toBeTruthy();
    expect(within(attempt).getByText("eligible-processing patch")).toBeTruthy();
    expect(within(attempt).getByText("Live Meta search")).toBeTruthy();
    expect(within(attempt).getByText("The bounded search completed; no exploit was found within the stated budget.")).toBeTruthy();
    expect(within(attempt).getByText("4 requests")).toBeTruthy();
    expect(within(attempt).getByText("2 trials")).toBeTruthy();
    expect(within(attempt).getByText("7 actions")).toBeTruthy();
    expect(within(attempt).getByText("Test batch eligibility.")).toBeTruthy();
    expect(within(attempt).getByText("wait → finish")).toBeTruthy();

    const loadedEvidence = screen.getByRole("region", { name: "Loaded replay evidence" });
    expect(within(loadedEvidence).getByText("Exploit independently verified")).toBeTruthy();
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
    await user.click(screen.getByRole("button", { name: "Interpret with Meta" }));

    expect(await screen.findByText("Pays seven points once after aluminium processing.")).toBeTruthy();
    expect(screen.getByText("Reward trigger")).toBeTruthy();
    expect(screen.getByText("Paid materials")).toBeTruthy();
    expect(screen.getByText("Eligibility required")).toBeTruthy();
    expect(screen.getByText("Repeat limit")).toBeTruthy();
    expect(screen.getByText("Successful processing required")).toBeTruthy();
    expect(screen.getByText("aluminium")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Activate candidate" }));
    expect((screen.getByLabelText("Reward policy") as HTMLTextAreaElement).value).toBe(sourceText);
    await user.click(screen.getByRole("tab", { name: /^Validate/i }));
    const validation = screen.getByRole("tabpanel", { name: /^Validate/i });
    expect(within(validation).getByText(sourceText)).toBeTruthy();
    const activePolicy = screen.getByText(/^Active policy/).closest("section");
    expect(activePolicy).not.toBeNull();
    expect(within(activePolicy!).getByText("process", { selector: "dd" })).toBeTruthy();
    expect(within(activePolicy!).getByText("aluminium items", { selector: "dd" })).toBeTruthy();
    expect(within(activePolicy!).getByText("+7", { selector: "dd" })).toBeTruthy();
    expect(screen.getAllByText("Expected 60 · actual 21")).toHaveLength(3);
    expect(screen.getByText(/A different policy is not invalid/)).toBeTruthy();
  });
});
