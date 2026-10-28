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
    <section className="timeline-panel" aria-labelledby="timeline-title">
      <div className="timeline-heading">
        <div>
          <p className="eyebrow">Host-derived trace</p>
          <h2 id="timeline-title">Event timeline</h2>
        </div>
        <p>Use ← → to step · Space to play</p>
      </div>
      <ol className="timeline-list">
        {frames.slice(1).map((frame, index) => {
          const event = frame.events.at(-1)!;
          const payout = frame.payouts.length > frames[index]!.payouts.length;
          return (
            <li key={event.sequence}>
              <button
                aria-current={index + 1 === activeFrame ? "step" : undefined}
                className={`${index + 1 === activeFrame ? "is-active" : ""}${payout ? " has-payout" : ""}`}
                type="button"
                onClick={() => onSelect(index + 1)}
              >
                <span>{event.tick}</span>
                <b>{describeEvent(event)}</b>
                {payout && <em>+10 payout</em>}
              </button>
            </li>
          );
        })}
      </ol>
      {reasoning && (
        <aside className="timeline-reasoning" aria-labelledby="timeline-reasoning-title">
          <p className="eyebrow">Model claim vs host evidence</p>
          <h3 id="timeline-reasoning-title">Attack reasoning</h3>
          <dl>
            <div><dt>Model hypothesis</dt><dd>{reasoning.hypothesis}</dd></div>
            <div><dt>Test</dt><dd><code>{reasoning.test}</code></dd></div>
            <div><dt>Host observation</dt><dd>{reasoning.observation}</dd></div>
            <div><dt>Host verdict</dt><dd>{reasoning.verdict}</dd></div>
          </dl>
        </aside>
      )}
    </section>
  );
}
