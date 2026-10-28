import type { Action } from "../../../../packages/engine/src/actions.js";
import { canonicalHash } from "../../../../packages/engine/src/canonical-hash.js";
import { step } from "../../../../packages/engine/src/step.js";
import type { Position, WorldState } from "../../../../packages/engine/src/types.js";
import { replayActions } from "../../../../packages/evaluation/src/replay.js";
import type { Policy } from "../../../../packages/policy/src/schema.js";
import { emptyVerification, verifyCandidate, type VerificationResult } from "./verifier.js";

interface SimpleActionSearchOptions {
  readonly seed: number;
  readonly maxExpandedStates: number;
  readonly maxActions: number;
  readonly beamWidth: number;
}

export interface SimpleActionSearchResult {
  readonly status: "exploit_verified" | "no_exploit_found_within_budget";
  readonly actions: readonly Action[];
  readonly actionsToFirstExploit: number | null;
  readonly expandedStates: number;
  readonly rejectedClaims: 0;
  readonly verification: VerificationResult;
}

interface SearchNode {
  readonly state: WorldState;
  readonly actions: readonly Action[];
  readonly score: number;
  readonly tie: number;
}

function distance(left: Position, right: Position): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function legalSearchActions(state: WorldState): readonly Action[] {
  const itemActions = state.items.flatMap<Action>((item) => [
    { type: "take", itemId: item.id },
    { type: "retrieve", itemId: item.id },
    { type: "process", itemId: item.id },
  ]);
  const candidates: readonly Action[] = [
    { type: "move", direction: "up" },
    { type: "move", direction: "right" },
    { type: "move", direction: "down" },
    { type: "move", direction: "left" },
    ...itemActions,
    { type: "deposit" },
  ];
  return candidates.filter((action) => step(state, action).events.every((event) => event.success));
}

function searchKey(state: WorldState): string {
  return canonicalHash({ ...state, tick: 0, terminal: false });
}

function tieBreaker(key: string, seed: number): number {
  let value = seed >>> 0;
  for (const character of key) value = Math.imul(value ^ character.charCodeAt(0), 16_777_619) >>> 0;
  return value;
}

function nodeScore(state: WorldState, actionCount: number): number {
  const inventory = state.items.find((item) => item.locus.kind === "inventory");
  const hopperCount = state.items.filter((item) => item.locus.kind === "hopper").length;
  const inputCount = state.items.filter((item) => item.locus.kind === "input").length;
  const target = inventory
    ? state.stations.hopper
    : inputCount > 0
      ? state.stations.input
      : state.stations.processor;
  const serviceDistance = Math.max(0, distance(state.worker.position, target) - 1);
  const rewardWithoutUsefulWork = Math.max(
    0,
    state.rewardLedger.totalPoints - state.outcomeLedger.processedEligibleItemIds.length * 10,
  );
  return (
    rewardWithoutUsefulWork * 100_000 +
    hopperCount * 1_000 +
    state.outcomeLedger.processedEligibleItemIds.length * 200 -
    serviceDistance * 10 -
    actionCount
  );
}

export function runSimpleActionSearch(
  initialState: WorldState,
  policy: Policy,
  options: SimpleActionSearchOptions,
): SimpleActionSearchResult {
  const visited = new Set([searchKey(initialState)]);
  let expandedStates = 0;
  let beam: SearchNode[] = [
    { state: initialState, actions: [], score: nodeScore(initialState, 0), tie: options.seed },
  ];

  for (let depth = 0; depth < options.maxActions && expandedStates < options.maxExpandedStates; depth += 1) {
    const nextBeam: SearchNode[] = [];
    for (const node of beam) {
      for (const action of legalSearchActions(node.state)) {
        if (expandedStates >= options.maxExpandedStates) break;
        expandedStates += 1;
        const actions = [...node.actions, action];
        const replay = replayActions(node.state, [action], policy);
        const key = searchKey(replay.state);
        if (visited.has(key)) continue;
        visited.add(key);
        const verification = verifyCandidate(initialState, policy, actions);
        if (verification.status === "exploit_verified") {
          return {
            status: "exploit_verified",
            actions,
            actionsToFirstExploit: actions.length,
            expandedStates,
            rejectedClaims: 0,
            verification,
          };
        }
        nextBeam.push({
          state: replay.state,
          actions,
          score: nodeScore(replay.state, actions.length),
          tie: tieBreaker(key, options.seed),
        });
      }
    }
    nextBeam.sort((left, right) => right.score - left.score || left.tie - right.tie);
    beam = nextBeam.slice(0, options.beamWidth);
    if (beam.length === 0) break;
  }

  return {
    status: "no_exploit_found_within_budget",
    actions: [],
    actionsToFirstExploit: null,
    expandedStates,
    rejectedClaims: 0,
    verification: emptyVerification("no_exploit_found_within_budget"),
  };
}
