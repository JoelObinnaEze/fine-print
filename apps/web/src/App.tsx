import { useEffect, useMemo, useState } from "react";

import { CommerceWorkbench } from "./commerce/CommerceWorkbench.js";
import { Depot } from "./depot/Depot.js";
import {
  RedTeamArena,
  scriptedEvidence,
  type AttackTarget,
  type RunEvidence,
} from "./arena/RedTeamArena.js";
import { PolicyCard } from "./policy/PolicyCard.js";
import { PolicyGauntlet } from "./policy/PolicyGauntlet.js";
import { PolicyLab } from "./policy/PolicyLab.js";
import { EventTimeline } from "./replay/EventTimeline.js";
import { ReplayControls } from "./replay/ReplayControls.js";
import { handleTabKeyDown } from "./tab-navigation.js";
import {
  createReplayFrames,
  patchPolicies,
  patchLabels,
  exploitActions,
  patchSourceTexts,
  startingPolicy,
  startingPolicySourceText,
  type PatchId,
} from "./replay-data.js";
import type { Policy } from "../../../packages/policy/src/index.js";

type WorkspaceId = "commerce" | "bottle";
type BottleView = "attack" | "replay" | "validate";

const bottleViews: readonly { id: BottleView; label: string; description: string }[] = [
  { id: "attack", label: "Step 1 · Your rule", description: "What should happen" },
  { id: "replay", label: "Step 2 · What went wrong", description: "Confirmed replay" },
  { id: "validate", label: "Step 3 · Best repair", description: "Keep honest rewards" },
];

export function App() {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>("commerce");
  const [bottleView, setBottleView] = useState<BottleView>("attack");
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [activePatch, setActivePatch] = useState<PatchId | null>(null);
  const [traceActions, setTraceActions] = useState(exploitActions);
  const [evidence, setEvidence] = useState<RunEvidence>(scriptedEvidence);
  const [activePolicy, setActivePolicy] = useState<Policy>(startingPolicy);
  const [sourceText, setSourceText] = useState(startingPolicySourceText);
  const attackTarget: AttackTarget = activePatch
    ? {
        label: patchLabels[activePatch],
        policy: patchPolicies[activePatch],
        sourceText: patchSourceTexts[activePatch],
      }
    : { label: "active policy", policy: activePolicy, sourceText };
  const activeFrames = useMemo(
    () => createReplayFrames(activePolicy, traceActions),
    [activePolicy, traceActions],
  );
  const frame = activeFrames[frameIndex]!;
  const completedFrame = activeFrames.at(-1)!;
  const patchedFrames = useMemo(
    () =>
      activePatch
        ? createReplayFrames(patchPolicies[activePatch], traceActions)
        : null,
    [activePatch, traceActions],
  );
  const patchedFrame = patchedFrames?.[frameIndex];
  const nextPayoutFrame = useMemo(
    () =>
      activeFrames.findIndex(
        (candidate, index) =>
          index > frameIndex && candidate.payouts.length > frame.payouts.length,
      ),
    [activeFrames, frame.payouts.length, frameIndex],
  );

  useEffect(() => {
    if (!isPlaying) return;
    if (frameIndex === activeFrames.length - 1) {
      setIsPlaying(false);
      return;
    }
    const timeout = window.setTimeout(
      () =>
        setFrameIndex((current) => Math.min(current + 1, activeFrames.length - 1)),
      650 / speed,
    );
    return () => window.clearTimeout(timeout);
  }, [activeFrames.length, frameIndex, isPlaying, speed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (event.target.closest("button, input, textarea, select, a, [contenteditable='true']")) return;
      if (!event.target.closest("[data-replay-shortcuts]")) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setFrameIndex((current) => Math.min(current + 1, activeFrames.length - 1));
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setFrameIndex((current) => Math.max(0, current - 1));
      }
      if (event.key === " ") {
        event.preventDefault();
        setIsPlaying((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeFrames.length]);

  const selectFrame = (index: number) => {
    setIsPlaying(false);
    setFrameIndex(index);
  };

  const selectWorkspace = (workspace: WorkspaceId) => {
    setIsPlaying(false);
    setActiveWorkspace(workspace);
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-brand">
          <h1>Fine Print</h1>
          <p>Test reward rules before launch.</p>
        </div>
        <nav className="workspace-tabs" aria-label="Choose an incentive system" role="tablist" onKeyDown={handleTabKeyDown}>
          <button
            aria-controls="commerce-workspace"
            aria-selected={activeWorkspace === "commerce"}
            id="workspace-tab-commerce"
            onClick={() => selectWorkspace("commerce")}
            role="tab"
            type="button"
          >
            <b>Commerce audit</b>
            <span>Referral rewards</span>
          </button>
          <button
            aria-controls="bottle-workspace"
            aria-selected={activeWorkspace === "bottle"}
            id="workspace-tab-bottle"
            onClick={() => selectWorkspace("bottle")}
            role="tab"
            type="button"
          >
            <b>Bottle Return lab</b>
            <span>Processing rewards</span>
          </button>
        </nav>
      </header>

      <main>
        <div
          aria-labelledby="workspace-tab-commerce"
          hidden={activeWorkspace !== "commerce"}
          id="commerce-workspace"
          role="tabpanel"
        >
          <CommerceWorkbench />
        </div>
        <section
          aria-labelledby="workspace-tab-bottle"
          className="bottle-domain"
          hidden={activeWorkspace !== "bottle"}
          id="bottle-workspace"
          role="tabpanel"
        >
          <div className="bottle-domain__heading">
            <div>
              <h2>Test whether points reflect real recycling.</h2>
              <p>Muse searches for ways points can be paid before recycling is proven. Fine Print replays each idea and compares repairs that keep honest rewards.</p>
            </div>
            <dl className="bottle-domain__metrics">
              <div><dt>Reward paid</dt><dd><output aria-label="Reward paid">{completedFrame.state.rewardLedger.totalPoints}</output></dd></div>
              <div><dt>Items recycled</dt><dd><output aria-label="Items recycled">{completedFrame.state.outcomeLedger.processedEligibleItemIds.length}</output></dd></div>
              <div><dt>Actions replayed</dt><dd><output aria-label="Actions replayed">{traceActions.length}</output></dd></div>
            </dl>
          </div>
          <nav className="bottle-workspace__tabs" aria-label="Bottle Return workflow" role="tablist" onKeyDown={handleTabKeyDown}>
            {bottleViews.map((view) => (
              <button
                aria-controls={`bottle-panel-${view.id}`}
                aria-selected={bottleView === view.id}
                id={`bottle-tab-${view.id}`}
                key={view.id}
                onClick={() => {
                  setIsPlaying(false);
                  setBottleView(view.id);
                  if (view.id === "replay") setFrameIndex(activeFrames.length - 1);
                }}
                role="tab"
                type="button"
              >
                <b>{view.label}</b>
                <span>{view.description}</span>
              </button>
            ))}
          </nav>

          <div
            aria-labelledby="bottle-tab-attack"
            className="bottle-workspace__panel"
            hidden={bottleView !== "attack"}
            id="bottle-panel-attack"
            role="tabpanel"
          >
            <RedTeamArena
              evidence={evidence}
              activeSourceText={sourceText}
              attackTarget={attackTarget}
              onActivatePolicy={(policy, text) => {
                setActivePolicy(policy);
                setSourceText(text);
                setIsPlaying(false);
                setFrameIndex(0);
                setActivePatch(null);
                setTraceActions(exploitActions);
                setEvidence(scriptedEvidence);
              }}
              onLoadTrace={(actions, nextEvidence, target) => {
                setIsPlaying(false);
                setFrameIndex(0);
                setActivePatch(null);
                setTraceActions(actions);
                setEvidence(nextEvidence);
                setActivePolicy(target.policy);
                setSourceText(target.sourceText);
              }}
            />
          </div>

          {bottleView !== "attack" && (
          <div
            aria-labelledby={`bottle-tab-${bottleView}`}
            className="bottle-workspace__panel"
            id={`bottle-panel-${bottleView}`}
            role="tabpanel"
          >
            {bottleView === "replay" && (
              <>
                <div className="game-layout game-layout--replay">
                  <Depot state={frame.state} />
                  <aside className="evidence-panel" aria-label="Run evidence">
                    <h2>Replay what happened</h2>
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
                    <details className="receipt-stack" aria-live="polite">
                      <summary>Show payout receipts</summary>
                      {frame.payouts.length === 0 ? (
                        <p className="empty-receipt">No payout yet.</p>
                      ) : (
                        frame.payouts.map((payout, index) => (
                          <p className="receipt" key={`${payout.eventSequence}-${payout.clauseId}-${index}`}>
                            <b>+{payout.amount}</b>
                            <span>{payout.clauseId} paid {payout.amount} points to {payout.itemId} at tick {payout.eventSequence}.</span>
                          </p>
                        ))
                      )}
                    </details>
                    {patchedFrame && (
                      <section className="comparison-panel" aria-label="Patch comparison">
                        <h3>Counterfactual replay</h3>
                        <p className="comparison-basis">Same root state · same {frameIndex} actions · separate ledgers</p>
                        <div className="comparison-values">
                          <p><span>Original</span><output aria-label="Original paid points">{frame.state.rewardLedger.totalPoints}</output></p>
                          <p><span>Patched</span><output aria-label="Patched paid points">{patchedFrame.state.rewardLedger.totalPoints}</output></p>
                        </div>
                        {activePatch === "eligibleProcessing" && frame.state.rewardLedger.totalPoints > 0 && <p className="comparison-verdict">This failure stopped paying.</p>}
                        {activePatch === "oncePerItem" && frame.state.rewardLedger.totalPoints > patchedFrame.state.rewardLedger.totalPoints && <p className="comparison-verdict">Repeated payouts stopped; premature deposit payment remains.</p>}
                      </section>
                    )}
                  </aside>
                </div>
                <ReplayControls
                  frame={frameIndex}
                  frameCount={activeFrames.length}
                  isPlaying={isPlaying}
                  speed={speed}
                  canJumpToPayout={nextPayoutFrame >= 0}
                  onFrameChange={selectFrame}
                  onPlayToggle={() => {
                    if (!isPlaying && frameIndex === activeFrames.length - 1) {
                      setFrameIndex(0);
                      setIsPlaying(true);
                      return;
                    }
                    setIsPlaying((current) => !current);
                  }}
                  onSpeedChange={setSpeed}
                  onJumpToPayout={() => nextPayoutFrame >= 0 && selectFrame(nextPayoutFrame)}
                />
                <EventTimeline frames={activeFrames} activeFrame={frameIndex} reasoning={evidence.reasoning ?? null} onSelect={selectFrame} />
              </>
            )}

            {bottleView === "validate" && (
              <section className="bottle-repair" aria-labelledby="bottle-repair-title">
                <div className="bottle-repair__recommendation">
                  <div>
                    <span>Recommended repair</span>
                    <h2 id="bottle-repair-title">Require successful processing</h2>
                    <p>Pay once, only after an eligible item is actually recycled.</p>
                  </div>
                  <button
                    aria-pressed={activePatch === "eligibleProcessing"}
                    type="button"
                    onClick={() => setActivePatch("eligibleProcessing")}
                  >
                    Use recommended repair
                  </button>
                </div>
                <details className="commerce__technical bottle-repair__details">
                  <summary>Compare every repair and benchmark</summary>
                  <div className="bottle-validation-grid">
                    <PolicyCard policy={activePolicy} activePatch={activePatch} onTestPatch={setActivePatch} sourceText={sourceText} />
                    <PolicyGauntlet policy={activePolicy} patchedPolicy={activePatch ? patchPolicies[activePatch] : null} activePatch={activePatch} onTestPatch={setActivePatch} />
                  </div>
                </details>
                <details className="commerce__technical bottle-repair__details">
                  <summary>Show technical evidence</summary>
                  <PolicyLab
                    originalPolicy={activePolicy}
                    patchedPolicy={activePatch ? patchPolicies[activePatch] : null}
                    frame={frame}
                    patchedFrame={patchedFrame ?? null}
                    actionCount={traceActions.length}
                    evidence={evidence}
                  />
                </details>
              </section>
            )}
          </div>
          )}
        </section>
      </main>
    </div>
  );
}
