// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../apps/web/src/App.js";
import {
  createReplayFrames,
  exploitActions,
  patchPolicies,
  replayFrames,
} from "../../apps/web/src/replay-data.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("offline replay game", () => {
  it("renders the depot, policy, counters, and accessible playback controls", () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "Fine Print" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Red-team arena" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load verified Muse run" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Bottle Return depot" })).toBeTruthy();
    expect(screen.getAllByText("Pay 10 points whenever an item is deposited.")).toHaveLength(2);
    expect(screen.getByLabelText("Paid points").textContent).toBe("0");
    expect(screen.getByLabelText("Actually recycled").textContent).toBe("0");
    expect(screen.getByRole("button", { name: "Play replay" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Replay position" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Policy Lab" })).toBeTruthy();
    expect(screen.getByText("Scripted fixture")).toBeTruthy();
    expect(screen.getByText("Observed traces, not a safety guarantee.")).toBeTruthy();
  });

  it("jumps to the next payout and keeps useful work separate", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Jump to next payout" }));

    expect(screen.getByLabelText("Paid points").textContent).toBe("10");
    expect(screen.getByLabelText("Actually recycled").textContent).toBe("0");
    expect(screen.getByText(/deposit-reward paid 10 points to B1/i)).toBeTruthy();
  });

  it("steps with the keyboard", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.keyboard("{ArrowRight}");
    expect(screen.getByLabelText("Current tick").textContent).toBe("1");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByLabelText("Current tick").textContent).toBe("0");
  });

  it("replays the same trace under a process-only patch without mutating the original", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /11.*Deposit B1/i }));
    await user.click(screen.getByRole("button", { name: "Test eligible-processing patch" }));

    expect(screen.getByLabelText("Original paid points").textContent).toBe("30");
    expect(screen.getByLabelText("Patched paid points").textContent).toBe("0");
    expect(screen.getByText("This exploit stopped paying.")).toBeTruthy();
    expect(screen.getByLabelText("Current tick").textContent).toBe("11");
    expect(screen.getByRole("row", { name: /Trigger deposit process/i })).toBeTruthy();
    expect(screen.getByRole("row", { name: /Eligibility required false true/i })).toBeTruthy();
    expect(screen.getByText("Server exports include the exact policy, actions, provenance, limits, and integrity hashes for offline replay.")).toBeTruthy();

    const { rewardLedger: originalLedger, ...originalPhysicalState } = replayFrames[11]!.state;
    const { rewardLedger: patchedLedger, ...patchedPhysicalState } =
      createReplayFrames(patchPolicies.eligibleProcessing)[11]!.state;
    expect(patchedPhysicalState).toEqual(originalPhysicalState);
    expect(patchedLedger).not.toBe(originalLedger);
  });

  it("runs the active policy and patch through the deterministic gauntlet", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("heading", { name: "Policy gauntlet" })).toBeTruthy();
    expect(screen.getByLabelText("Active tested-policy score").textContent).toBe("50");
    expect(screen.getByText("Repeat-deposit attack leaked 30 points")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Test eligible-processing patch" }));

    expect(screen.getByLabelText("Patched tested-policy score").textContent).toBe("100");
    expect(screen.getByText("2 / 2 adversarial attacks blocked")).toBeTruthy();
  });

  it("runs a live Meta attack and loads the host-verified trace", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
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
    render(<App />);

    expect(await screen.findByText(/Meta connected/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Run live Muse attack" }));

    expect(await screen.findByText("Live model")).toBeTruthy();
    expect(screen.getByText("muse-spark-1.3")).toBeTruthy();
    expect(screen.getByText("Test repeated deposits.")).toBeTruthy();
    expect(screen.getByLabelText("Replay position").getAttribute("max")).toBe("12");
  });

  it("interprets and explicitly activates a natural-language policy", async () => {
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
            reason: "Pays once after eligible processing.",
            policy: patchPolicies.eligibleProcessing,
          },
          usage: { actualUsd: 0.001 },
        });
      }
      return Response.json({ error: { message: "not found" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);
    const sourceText = "Pay 10 points once when an eligible bottle is processed.";

    await user.clear(screen.getByLabelText("Reward policy"));
    await user.type(screen.getByLabelText("Reward policy"), sourceText);
    await user.click(screen.getByRole("button", { name: "Interpret with Meta" }));

    expect(await screen.findByText("Pays once after eligible processing.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Activate candidate" }));
    expect(screen.getAllByText(sourceText)).toHaveLength(2);
    expect(screen.getByText("process", { selector: "dd" })).toBeTruthy();
    expect(screen.getByText("eligible items", { selector: "dd" })).toBeTruthy();
  });
});
