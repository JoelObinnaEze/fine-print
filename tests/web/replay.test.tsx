// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "../../apps/web/src/App.js";
import { createReplayFrames, patchPolicies, replayFrames } from "../../apps/web/src/replay-data.js";

afterEach(cleanup);

describe("offline replay game", () => {
  it("renders the depot, policy, counters, and accessible playback controls", () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "Fine Print" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Bottle Return depot" })).toBeTruthy();
    expect(screen.getByText("Pay 10 points whenever an item is deposited.")).toBeTruthy();
    expect(screen.getByLabelText("Paid points").textContent).toBe("0");
    expect(screen.getByLabelText("Actually recycled").textContent).toBe("0");
    expect(screen.getByRole("button", { name: "Play replay" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Replay position" })).toBeTruthy();
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

    const { rewardLedger: originalLedger, ...originalPhysicalState } = replayFrames[11]!.state;
    const { rewardLedger: patchedLedger, ...patchedPhysicalState } =
      createReplayFrames(patchPolicies.eligibleProcessing)[11]!.state;
    expect(patchedPhysicalState).toEqual(originalPhysicalState);
    expect(patchedLedger).not.toBe(originalLedger);
  });
});
