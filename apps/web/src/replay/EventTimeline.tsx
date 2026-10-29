import type { EngineEvent } from "../../../../packages/engine/src/index.js";

import type { ReplayFrame } from "../replay-data.js";
import type { AttackReasoning } from "../arena/RedTeamArena.js";

function describeEvent(event: EngineEvent): string {
  if (!event.success) return `Action rejected: ${event.reason?.replaceAll("_", " ")}`;
  if (event.kind === "move") return "Agent moved";
  if (event.kind === "finish") return "Replay finished";
  return `${event.kind[0]!.toUpperCase()}${event.kind.slice(1)}${event.itemId ? ` ${event.itemId}` : ""}`;
}

export function EventTimeline({
  frames,
  activeFrame,
  reasoning,
  onSelect,
}: {
  readonly frames: readonly ReplayFrame[];
  readonly activeFrame: number;
  readonly reasoning: AttackReasoning | null;
  readonly onSelect: (frame: number) => void;
}) {
  return (
    <section
      className="timeline-panel"
      aria-labelledby="timeline-title"
      data-replay-shortcuts=""
      tabIndex={0}
    >
      <div className="timeline-heading">
        <div>
          <h2 id="timeline-title">Event timeline</h2>
        </div>
        <p>Focus this panel · use ← → to step · Space to play</p>
      </div>
      <ol className="timeline-list">
        {frames.slice(1).map((frame, index) => {
          const event = frame.events.at(-1)!;
          const newPayouts = frame.payouts.slice(frames[index]!.payouts.length);
          const payoutAmount = newPayouts.reduce((total, payout) => total + payout.amount, 0);
          return (
            <li key={event.sequence}>
              <button
                aria-current={index + 1 === activeFrame ? "step" : undefined}
                className={`${index + 1 === activeFrame ? "is-active" : ""}${newPayouts.length > 0 ? " has-payout" : ""}`}
                type="button"
                onClick={() => onSelect(index + 1)}
              >
                <span>{event.tick}</span>
                <b>{describeEvent(event)}</b>
                {newPayouts.length > 0 && <em>+{payoutAmount} payout</em>}
              </button>
            </li>
          );
        })}
      </ol>
      {reasoning && (
        <details className="timeline-reasoning" aria-label="AI reasoning and simulator evidence">
          <summary>Show AI reasoning and simulator evidence</summary>
          <h3>Why Muse tried this</h3>
          <dl>
            <div><dt>AI test idea</dt><dd>{reasoning.hypothesis}</dd></div>
            <div><dt>Test</dt><dd><code>{reasoning.test}</code></dd></div>
            <div><dt>Simulator result</dt><dd>{reasoning.observation}</dd></div>
            <div><dt>Verdict</dt><dd>{reasoning.verdict}</dd></div>
          </dl>
        </details>
      )}
    </section>
  );
}
