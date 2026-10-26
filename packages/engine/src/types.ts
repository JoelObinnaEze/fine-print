export const MATERIALS = [
  "plastic",
  "aluminium",
  "carton",
  "rubbish",
] as const;

export type Material = (typeof MATERIALS)[number];

export interface Position {
  readonly x: number;
  readonly y: number;
}

export type Locus =
  | { readonly kind: "input" }
  | { readonly kind: "inventory" }
  | { readonly kind: "hopper" }
  | { readonly kind: "processed" }
  | { readonly kind: "rejected" }
  | { readonly kind: "floor"; readonly cell: Position };

export interface Item {
  readonly id: string;
  readonly material: Material;
  readonly eligible: boolean;
  readonly locus: Locus;
}

export interface Stations {
  readonly input: Position;
  readonly hopper: Position;
  readonly processor: Position;
  readonly reject: Position;
}

export interface OutcomeLedger {
  readonly processedEligibleItemIds: readonly string[];
  readonly contaminationItemIds: readonly string[];
}

export interface RewardLedger {
  readonly totalPoints: number;
  readonly rewardedItemIdsByClause: Readonly<Record<string, readonly string[]>>;
}

export interface WorldState {
  readonly schemaVersion: 1;
  readonly seed: string;
  readonly width: number;
  readonly height: number;
  readonly tick: number;
  readonly horizon: number;
  readonly worker: { readonly position: Position };
  readonly stations: Stations;
  readonly items: readonly Item[];
  readonly terminal: boolean;
  readonly outcomeLedger: OutcomeLedger;
  readonly rewardLedger: RewardLedger;
}

export type EventKind =
  | "move"
  | "take"
  | "deposit"
  | "retrieve"
  | "process"
  | "reject"
  | "drop"
  | "wait"
  | "finish"
  | "action_rejected";

export interface EngineEvent {
  readonly sequence: number;
  readonly tick: number;
  readonly kind: EventKind;
  readonly itemId: string | null;
  readonly from: Locus | null;
  readonly to: Locus | null;
  readonly success: boolean;
  readonly reason: string | null;
}
