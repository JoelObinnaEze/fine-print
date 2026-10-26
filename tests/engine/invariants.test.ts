import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  createBottleReturnState,
  step,
  type Action,
} from "../../packages/engine/src/index.js";

const itemId = fc.constantFrom("B1", "B2", "B3", "C1", "C2", "C3", "X1", "R1", "missing");
const action: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    type: fc.constant("move"),
    direction: fc.constantFrom("up", "down", "left", "right"),
  }),
  fc.record({ type: fc.constant("take"), itemId }),
  fc.constant({ type: "deposit" }),
  fc.record({ type: fc.constant("retrieve"), itemId }),
  fc.record({ type: fc.constant("process"), itemId }),
  fc.constant({ type: "reject" }),
  fc.constant({ type: "drop" }),
  fc.constant({ type: "wait" }),
  fc.constant({ type: "finish" }),
);

describe("engine invariants", () => {
  it("preserves item identity, locus uniqueness, capacity, and terminal states across 1,000 traces", () => {
    fc.assert(
      fc.property(fc.array(action, { maxLength: 150 }), (actions) => {
        let state = createBottleReturnState();
        const originalIds = state.items.map((item) => item.id);

        for (const nextAction of actions) {
          const previous = state;
          state = step(state, nextAction).nextState;

          expect(state.items.map((item) => item.id)).toEqual(originalIds);
          expect(new Set(state.items.map((item) => item.id)).size).toBe(8);
          expect(state.items.filter((item) => item.locus.kind === "inventory").length).toBeLessThanOrEqual(1);
          expect(state.tick).toBeLessThanOrEqual(state.horizon);

          for (const item of previous.items) {
            if (item.locus.kind === "processed" || item.locus.kind === "rejected") {
              expect(state.items.find((candidate) => candidate.id === item.id)?.locus).toEqual(item.locus);
            }
          }

          if (previous.terminal) {
            expect(state).toBe(previous);
          }
        }
      }),
      { numRuns: 1_000, seed: 20261026 },
    );
  });
});
