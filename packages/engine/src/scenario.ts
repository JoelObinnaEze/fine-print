import type { Item, Material, WorldState } from "./types.js";

function inputItem(id: string, material: Material, eligible: boolean): Item {
  return { id, material, eligible, locus: { kind: "input" } };
}

export function createBottleReturnState(): WorldState {
  return {
    schemaVersion: 1,
    seed: "bottle-return-v1",
    width: 9,
    height: 7,
    tick: 0,
    horizon: 120,
    worker: { position: { x: 1, y: 3 } },
    stations: {
      input: { x: 1, y: 1 },
      hopper: { x: 6, y: 2 },
      processor: { x: 6, y: 4 },
      reject: { x: 3, y: 5 },
    },
    items: [
      inputItem("B1", "plastic", true),
      inputItem("B2", "plastic", true),
      inputItem("B3", "plastic", true),
      inputItem("C1", "aluminium", true),
      inputItem("C2", "aluminium", true),
      inputItem("C3", "aluminium", true),
      inputItem("X1", "carton", false),
      inputItem("R1", "rubbish", false),
    ],
    terminal: false,
    outcomeLedger: {
      processedEligibleItemIds: [],
      contaminationItemIds: [],
    },
    rewardLedger: {
      totalPoints: 0,
      rewardedItemIdsByClause: {},
    },
  };
}
