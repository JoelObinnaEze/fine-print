import { useEffect, useMemo, useState } from "react";

import { Depot } from "./depot/Depot.js";
import { PolicyCard } from "./policy/PolicyCard.js";
import { EventTimeline } from "./replay/EventTimeline.js";
import { ReplayControls } from "./replay/ReplayControls.js";
import {
  createReplayFrames,
  patchPolicies,
  replayFrames,
  startingPolicy,
  type PatchId,
} from "./replay-data.js";

export function App() {
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [activePatch, setActivePatch] = useState<PatchId | null>(null);
  const frame = replayFrames[frameIndex]!;
  const patchedFrames = useMemo(
    () => (activePatch ? createReplayFrames(patchPolicies[activePatch]) : null),
    [activePatch],
  );
  const patchedFrame = patchedFrames?.[frameIndex];
  const nextPayoutFrame = useMemo(
    () =>
      replayFrames.findIndex(
        (candidate, index) =>
          index > frameIndex && candidate.payouts.length > frame.payouts.length,
      ),
    [frame.payouts.length, frameIndex],
  );

  useEffect(() => {
    if (!isPlaying) return;
    if (frameIndex === replayFrames.length - 1) {
      setIsPlaying(false);
      return;
    }
    const timeout = window.setTimeout(
      () =>
        setFrameIndex((current) => Math.min(current + 1, replayFrames.length - 1)),
      650 / speed,
    );
    return () => window.clearTimeout(timeout);
  }, [frameIndex, isPlaying, speed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowRight") {
        setFrameIndex((current) => Math.min(current + 1, replayFrames.length - 1));
      }
      if (event.key === "ArrowLeft") {
        setFrameIndex((current) => Math.max(0, current - 1));
      }
      if (event.key === " ") {
        event.preventDefault();
        setIsPlaying((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectFrame = (index: number) => {
    setIsPlaying(false);
    setFrameIndex(index);
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <div>
          <p className="eyebrow">Executable incentive test · scripted fixture</p>
          <h1>Fine Print</h1>
        </div>
        <p className="tagline">You write the rules. The AI finds what you forgot.</p>
      </header>

      <main className="game-layout">
        <PolicyCard
          policy={startingPolicy}
          activePatch={activePatch}
          onTestPatch={setActivePatch}
        />
        <Depot state={frame.state} />
        <aside className="evidence-panel" aria-label="Run evidence">
          <p className="eyebrow">Observed result</p>
          <h2>Reward ≠ outcome</h2>
          <div className="counter counter--reward">
            <span>Paid points</span>
            <output aria-label="Paid points">{frame.state.rewardLedger.totalPoints}</output>
          </div>
          <div className="counter counter--useful">
            <span>Actually recycled</span>
            <output aria-label="Actually recycled">
              {frame.state.outcomeLedger.processedEligibleItemIds.length}
            </output>
          </div>
          <div className="receipt-stack" aria-live="polite">
            <h3>Payout receipts</h3>
            {frame.payouts.length === 0 ? (
              <p className="empty-receipt">No payout yet.</p>
            ) : (
              frame.payouts.map((payout, index) => (
                <p
                  className="receipt"
                  key={`${payout.eventSequence}-${payout.clauseId}-${index}`}
                >
                  <b>+{payout.amount}</b>
                  <span>
                    {payout.clauseId} paid {payout.amount} points to {payout.itemId} at tick {payout.eventSequence}.
                  </span>
                </p>
              ))
            )}
          </div>
          {patchedFrame && (
            <section className="comparison-panel" aria-label="Patch comparison">
              <h3>Counterfactual replay</h3>
              <p className="comparison-basis">Same root state · same {frameIndex} actions · separate ledgers</p>
              <div className="comparison-values">
                <p>
                  <span>Original</span>
                  <output aria-label="Original paid points">{frame.state.rewardLedger.totalPoints}</output>
                </p>
                <p>
                  <span>Patched</span>
                  <output aria-label="Patched paid points">{patchedFrame.state.rewardLedger.totalPoints}</output>
                </p>
              </div>
              {activePatch === "eligibleProcessing" && frame.state.rewardLedger.totalPoints > 0 && (
                <p className="comparison-verdict">This exploit stopped paying.</p>
              )}
              {activePatch === "oncePerItem" && frame.state.rewardLedger.totalPoints > patchedFrame.state.rewardLedger.totalPoints && (
                <p className="comparison-verdict">Repeated payouts stopped; premature deposit payment remains.</p>
              )}
            </section>
          )}
        </aside>
      </main>

      <ReplayControls
        frame={frameIndex}
        frameCount={replayFrames.length}
        isPlaying={isPlaying}
        speed={speed}
        canJumpToPayout={nextPayoutFrame >= 0}
        onFrameChange={selectFrame}
        onPlayToggle={() => setIsPlaying((current) => !current)}
        onSpeedChange={setSpeed}
        onJumpToPayout={() => nextPayoutFrame >= 0 && selectFrame(nextPayoutFrame)}
      />
      <EventTimeline
        frames={replayFrames}
        activeFrame={frameIndex}
        onSelect={selectFrame}
      />
    </div>
  );
}
