import { canonicalHash, ENGINE_VERSION } from "../../engine/src/index.js";

import type { ReplayResult } from "./replay.js";

export function hashReplay(replay: ReplayResult): string {
  return canonicalHash({ engineVersion: ENGINE_VERSION, replay });
}
