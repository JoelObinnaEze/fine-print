# Fine Print task ledger

## Task 1: Establish the repository foundation

**Description:** Create the npm workspace, strict TypeScript configuration, test runner, durable project rules, and safe ignore/config defaults.

**Acceptance criteria:**
- [x] Clean `npm ci` produces the pinned toolchain.
- [x] `.env` and generated output are ignored; `.env.example` contains only placeholders and safe defaults.
- [x] `npm test`, `npm run typecheck`, and `npm run build` exist.

**Verification:** Passed `npm install --ignore-scripts`, `npm test`, `npm run typecheck`, `npm run build`, `npm audit --audit-level=high`, and a staged secret-file check on October 26, 2026.

**Dependencies:** None

**Files likely touched:** `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `.env.example`

**Estimated scope:** Medium

## Task 2: Define Bottle Return contracts and initial state

**Description:** Define loci, items, world state, actions, events, and the deterministic seeded Bottle Return initial state.

**Acceptance criteria:**
- [ ] The 9×7 world contains six eligible and two ineligible stable item IDs at exactly one locus each.
- [ ] Worker, station, capacity, tick, horizon, and terminal state match the specification.
- [ ] Action decoding rejects unknown/invalid shapes at the boundary.

**Verification:** Focused unit tests and TypeScript exhaustive checks.

**Dependencies:** Task 1

**Files likely touched:** `packages/engine/src/types.ts`, `packages/engine/src/scenario.ts`, `packages/engine/src/actions.ts`, `packages/engine/src/index.ts`, `tests/engine/state.test.ts`

**Estimated scope:** Medium

## Task 3: Execute the deposit/retrieve exploit path

**Description:** Implement pure transitions for move, take, deposit, retrieve, wait, and finish, including deterministic invalid-action events.

**Acceptance criteria:**
- [ ] A bottle can be deposited, retrieved, and deposited again without duplicating identity.
- [ ] Every action consumes one tick; invalid actions change no physical state and never substitute another action.
- [ ] Inputs remain immutable and repeated runs produce identical events.

**Verification:** Red/green trace tests plus full suite/typecheck/build.

**Dependencies:** Task 2

**Files likely touched:** `packages/engine/src/step.ts`, `packages/engine/src/legal-actions.ts`, `packages/engine/src/index.ts`, `tests/engine/step.test.ts`

**Estimated scope:** Medium

## Task 4: Complete physical actions and engine invariants

**Description:** Add process, reject, and drop with terminal/horizon enforcement and property-tested identity/locus invariants.

**Acceptance criteria:**
- [ ] All specified actions obey bounds, adjacency, capacity, and terminal rules.
- [ ] Processed/rejected items cannot be retrieved.
- [ ] At least 1,000 seeded random traces preserve unique IDs and one locus per item.

**Verification:** Vitest plus fast-check property suite.

**Dependencies:** Task 3

**Files likely touched:** `packages/engine/src/step.ts`, `packages/engine/src/legal-actions.ts`, `tests/engine/step.test.ts`, `tests/engine/invariants.test.ts`

**Estimated scope:** Medium

## Checkpoint: Deterministic world

- [ ] Full suite, typecheck, and build pass.
- [ ] Scripted deposit/retrieve loop is reproducible and preserves item identity.

## Task 5: Add strict policy validation and payout receipts

**Description:** Implement the bounded additive clause schema and deterministic receipt evaluation against successful engine events.

**Acceptance criteria:**
- [ ] Unknown fields, duplicate IDs, invalid enums, arrays, numbers, and unsupported semantics are rejected.
- [ ] Matching clauses pay independently in stable clause order.
- [ ] Once-per-item history is tracked per clause and run.

**Verification:** Policy validation and receipt unit tests.

**Dependencies:** Task 4

**Files likely touched:** `packages/policy/src/schema.ts`, `packages/policy/src/receipts.ts`, `packages/policy/src/index.ts`, `tests/policy/policy.test.ts`

**Estimated scope:** Medium

## Task 6: Separate rewards from useful recycling

**Description:** Implement the independent oracle and the three canonical policy traces: repeated deposit, once-per-item deposit, and eligible processing.

**Acceptance criteria:**
- [ ] Three deposits pay 30 while useful recycling remains zero under the starting rule.
- [ ] The once-per-item patch pays 10 but still records zero useful recycling.
- [ ] Eligible processing pays honest work while rubbish increases contamination only.

**Verification:** Focused oracle/receipt tests and full suite.

**Dependencies:** Task 5

**Files likely touched:** `packages/evaluation/src/oracle.ts`, `packages/evaluation/src/metrics.ts`, `packages/evaluation/src/index.ts`, `tests/policy/rewards.test.ts`

**Estimated scope:** Medium

## Task 7: Add canonical replay hashes and honest-worker scoring

**Description:** Hash canonical state and run complete honest-worker traces to calculate legitimate coverage and per-item leakage.

**Acceptance criteria:**
- [ ] Identical inputs yield identical SHA-256 hashes and replay results.
- [ ] Zero-pay and partial-material policies cannot score as successful.
- [ ] Per-item excess reward cannot be hidden by underpayment elsewhere.

**Verification:** Hash, replay, and metric tests.

**Dependencies:** Task 6

**Files likely touched:** `packages/engine/src/canonical-hash.ts`, `packages/evaluation/src/honest-worker.ts`, `packages/evaluation/src/metrics.ts`, `tests/engine/replay.test.ts`, `tests/policy/scoring.test.ts`

**Estimated scope:** Medium

## Task 8: Ship the offline replay game view

**Description:** Render the depot, worker/items, payout/useful counters, and an accessible event timeline from replay state.

**Acceptance criteria:**
- [ ] The exploit is visually understandable without reading technical internals.
- [ ] Play/pause, step, scrub, speed, jump-to-payout, keyboard controls, and text events work.
- [ ] Reduced-motion disables cosmetic interpolation without changing results.

**Verification:** Component tests, build, and real-browser console/accessibility/visual check.

**Dependencies:** Task 7

**Files likely touched:** `apps/web/src/App.tsx`, `apps/web/src/depot/Depot.tsx`, `apps/web/src/replay/Timeline.tsx`, `apps/web/src/styles.css`, `tests/e2e/replay.spec.ts`

**Estimated scope:** Medium

## Task 9: Add manual policy inspection and patch comparison

**Description:** Let the player inspect supported semantics, activate immutable manual presets, and replay identical actions under a patch.

**Acceptance criteria:**
- [ ] Draft edits never mutate an active run.
- [ ] Old/new runs use the same root state/actions and separate reward ledgers.
- [ ] The UI says an exploit stopped paying, not that the policy is safe.

**Verification:** Policy UI tests and browser end-to-end patch replay.

**Dependencies:** Task 8

**Files likely touched:** `apps/web/src/policy/PolicyEditor.tsx`, `apps/web/src/policy/PolicyDiff.tsx`, `apps/web/src/App.tsx`, `tests/e2e/patch-replay.spec.ts`

**Estimated scope:** Medium

## Checkpoint: Playable offline loop

- [ ] A user can inspect the flawed rule, watch the exploit, patch, and replay without inference.
- [ ] Browser console is clean and counters match host-derived fixtures.

## Task 10: Add the authoritative local run service

**Description:** Serve validated run creation/status/cancellation and ordered SSE events on localhost using the shared engine.

**Acceptance criteria:**
- [ ] Live state is backend-owned and event IDs resume correctly after reconnect.
- [ ] IDs and payload sizes are validated with one consistent error shape.
- [ ] State-changing starts honor idempotency keys.

**Verification:** Route integration tests and a localhost SSE reconnect test.

**Dependencies:** Task 7

**Files likely touched:** `apps/server/src/app.ts`, `apps/server/src/routes/runs.ts`, `apps/server/src/runs/service.ts`, `tests/server/runs.test.ts`

**Estimated scope:** Medium

## Task 11: Persist runs and recover safely

**Description:** Select a Node 24-compatible supported SQLite driver and persist policies, runs, events, payouts, actions, and idempotency claims transactionally.

**Acceptance criteria:**
- [ ] Unique run/sequence and idempotency constraints are enforced atomically.
- [ ] Restart marks unfinished inference interrupted and never repeats a paid request.
- [ ] Foreign keys and transactions preserve complete replay evidence.

**Verification:** Clean-install driver smoke test plus persistence/restart integration tests.

**Dependencies:** Task 10

**Files likely touched:** `apps/server/src/persistence/database.ts`, `apps/server/src/persistence/schema.ts`, `apps/server/src/runs/service.ts`, `tests/persistence/database.test.ts`

**Estimated scope:** Medium

## Task 12: Add safe configuration and usage reservations

**Description:** Validate server environment settings and reserve/settle bounded provider usage with live calls disabled by default.

**Acceptance criteria:**
- [ ] Missing credit confirmation or budget keeps live mode off.
- [ ] Reservations are serial/atomic; ambiguous timeouts retain worst-case cost.
- [ ] Health/usage responses never expose secrets.

**Verification:** Configuration and concurrent reservation tests.

**Dependencies:** Task 11

**Files likely touched:** `apps/server/src/config.ts`, `apps/server/src/budget/service.ts`, `apps/server/src/routes/usage.ts`, `tests/provider/budget.test.ts`

**Estimated scope:** Medium

## Task 13: Translate natural-language policies with Meta

**Description:** Add the server-only Meta adapter and schema-constrained translation, preserving literal omissions and unrelated patch semantics.

**Acceptance criteria:**
- [ ] Manual and model output pass the identical strict validator.
- [ ] Ambiguous/unsupported results cannot activate.
- [ ] No credential, prompt injection, or executable code reaches engine logic.

**Verification:** Recorded contract fixtures first; one bounded live smoke call only after user-confirmed credits and budget.

**Dependencies:** Task 12

**Files likely touched:** `apps/server/src/providers/meta.ts`, `apps/server/src/routes/policies.ts`, `packages/policy/src/interpret.ts`, `tests/provider/translation.test.ts`

**Estimated scope:** Medium

## Task 14: Run a bounded attacker and independently verify candidates

**Description:** Expose only inspect/act/reset/submit/conclude tools, enforce all host limits, and replay submitted actions from the immutable root.

**Acceptance criteria:**
- [ ] Unknown/duplicate/late/over-limit tool calls are rejected.
- [ ] Narrative without actions cannot verify an exploit.
- [ ] Final status and evidence come only from host replay.

**Verification:** Adversarial tool tests, recorded model fixture, then bounded live run when authorized.

**Dependencies:** Task 13

**Files likely touched:** `apps/server/src/runs/agent.ts`, `apps/server/src/runs/verifier.ts`, `prompts/attacker-v1.txt`, `tests/adversarial/agent.test.ts`

**Estimated scope:** Medium

## Task 15: Add Policy Lab, branching, and portable export

**Description:** Expose structured diffs, receipts, same/different-policy branching rules, and a hash-verified replay export.

**Acceptance criteria:**
- [ ] Same-policy branches inherit both ledgers; changed-policy branches reconstruct the prefix.
- [ ] Exported runs replay offline and reject corruption/version mismatch.
- [ ] Every run displays provenance and actual search limits.

**Verification:** Branch/persistence/export tests and browser flow.

**Dependencies:** Tasks 11 and 14

**Files likely touched:** `apps/web/src/policy/PolicyLab.tsx`, `apps/server/src/routes/exports.ts`, `scripts/export-run.ts`, `tests/persistence/export.test.ts`, `tests/e2e/policy-lab.spec.ts`

**Estimated scope:** Medium

## Task 16: Evaluate, polish, and prepare submission evidence

**Description:** Run offline families/seeds/baselines, record honest results, finish accessibility/usability checks, and prepare README/demo/submission artifacts.

**Acceptance criteria:**
- [ ] Required commands work from a clean clone and incomplete results say “not run.”
- [ ] Evaluation reports raw numerators/denominators, costs, limits, and replay agreement.
- [ ] Three-minute script, attribution, setup, license decision, and judge-access checklist are reviewable.

**Verification:** `npm ci`, full test/typecheck/build/E2E/evaluation, export replay, and incognito access rehearsal.

**Dependencies:** Task 15

**Files likely touched:** `scripts/evaluate.ts`, `docs/evaluation.md`, `docs/demo-script.md`, `docs/submission-checklist.md`, `README.md`

**Estimated scope:** Medium

## Checkpoint: Complete

- [ ] Core flow works end to end with truthful provenance.
- [ ] At least one authorized live Meta trace is independently verified or explicitly reported as not run/failed.
- [ ] No secrets are tracked and no paid/public action occurred without authorization.

