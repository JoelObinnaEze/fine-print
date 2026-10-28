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
- [x] The 9×7 world contains six eligible and two ineligible stable item IDs at exactly one locus each.
- [x] Worker, station, capacity, tick, horizon, and terminal state match the specification.
- [x] Action decoding rejects unknown/invalid shapes at the boundary.

**Verification:** Red test failed on missing exports, then a clean `npm ci`, focused/full tests, typecheck, build, and high-severity audit passed on the pinned Node 22.18.0 runtime.

**Dependencies:** Task 1

**Files likely touched:** `packages/engine/src/types.ts`, `packages/engine/src/scenario.ts`, `packages/engine/src/actions.ts`, `packages/engine/src/index.ts`, `tests/engine/state.test.ts`

**Estimated scope:** Medium

## Task 3: Execute the deposit/retrieve exploit path

**Description:** Implement pure transitions for move, take, deposit, retrieve, wait, and finish, including deterministic invalid-action events.

**Acceptance criteria:**
- [x] A bottle can be deposited, retrieved, and deposited again without duplicating identity.
- [x] Every action consumes one tick; invalid actions change no physical state and never substitute another action.
- [x] Inputs remain immutable and repeated runs produce identical events.

**Verification:** Three red tests failed before implementation; then 6 full-suite tests, typecheck, and build passed on October 26, 2026.

**Dependencies:** Task 2

**Files likely touched:** `packages/engine/src/step.ts`, `packages/engine/src/legal-actions.ts`, `packages/engine/src/index.ts`, `tests/engine/step.test.ts`

**Estimated scope:** Medium

## Task 4: Complete physical actions and engine invariants

**Description:** Add process, reject, and drop with terminal/horizon enforcement and property-tested identity/locus invariants.

**Acceptance criteria:**
- [x] All specified actions obey bounds, adjacency, capacity, and terminal rules.
- [x] Processed/rejected items cannot be retrieved.
- [x] At least 1,000 seeded random traces preserve unique IDs and one locus per item.

**Verification:** Four tests failed before implementation, including fast-check shrinking `finish → wait` to the terminal-state bug. After implementation and review mutation, 13 tests, 1,000 seeded property traces, typecheck, and build passed on October 26, 2026.

**Dependencies:** Task 3

**Files likely touched:** `packages/engine/src/step.ts`, `packages/engine/src/legal-actions.ts`, `tests/engine/step.test.ts`, `tests/engine/invariants.test.ts`

**Estimated scope:** Medium

## Checkpoint: Deterministic world

- [x] Full suite, typecheck, and build pass.
- [x] Scripted deposit/retrieve loop is reproducible and preserves item identity.

## Checkpoint: Runtime compatibility

- [x] Node 22.18.0 and Node 24.14.1 run clean installs, the full suite, strict typecheck, and build; `.nvmrc` pins the oldest verified runtime without requiring Node 24.
- [x] Node's built-in synchronous SQLite persists a file database, rolls back failed transactions, and enables foreign keys without a native compiler on both verified runtimes.
- [x] The Meta probe is server-only, host-allowlisted, bounded, timed out, and makes only `GET /v1/models`.
- [x] The configured Meta key authenticated against the official model catalog and exposed `muse-spark-1.3` on October 26, 2026.

## Task 5: Add strict policy validation and payout receipts

**Description:** Implement the bounded additive clause schema and deterministic receipt evaluation against successful engine events.

**Acceptance criteria:**
- [x] Unknown fields, duplicate IDs, invalid enums, arrays, numbers, and unsupported semantics are rejected.
- [x] Matching clauses pay independently in stable clause order.
- [x] Once-per-item history is tracked per clause and run.

**Verification:** Red import failure preceded implementation; then 12 policy validation/receipt tests, the full suite, typecheck, and build passed on October 26, 2026.

**Dependencies:** Task 4

**Files likely touched:** `packages/policy/src/schema.ts`, `packages/policy/src/receipts.ts`, `packages/policy/src/index.ts`, `tests/policy/policy.test.ts`

**Estimated scope:** Medium

## Task 6: Separate rewards from useful recycling

**Description:** Implement the independent oracle and the three canonical policy traces: repeated deposit, once-per-item deposit, and eligible processing.

**Acceptance criteria:**
- [x] Three deposits pay 30 while useful recycling remains zero under the starting rule.
- [x] The once-per-item patch pays 10 but still records zero useful recycling.
- [x] Eligible processing pays honest work while rubbish increases contamination only.

**Verification:** Red import failure preceded implementation; focused tests cover repeated deposits, the once-per-item patch, all six honest eligible items, and rubbish contamination. Full suite, typecheck, and build passed on October 26, 2026.

**Dependencies:** Task 5

**Files likely touched:** `packages/evaluation/src/oracle.ts`, `packages/evaluation/src/metrics.ts`, `packages/evaluation/src/index.ts`, `tests/policy/rewards.test.ts`

**Estimated scope:** Medium

## Task 7: Add canonical replay hashes and honest-worker scoring

**Description:** Hash canonical state and run complete honest-worker traces to calculate legitimate coverage and per-item leakage.

**Acceptance criteria:**
- [x] Identical inputs yield identical SHA-256 hashes and replay results.
- [x] Zero-pay and partial-material policies cannot score as successful.
- [x] Per-item excess reward cannot be hidden by underpayment elsewhere.

**Verification:** Six red tests preceded implementation. Canonical hashing, deterministic replay, complete honest-worker coverage, zero/partial/full scoring, and the per-item netting trap pass with the full suite, typecheck, and build on October 26, 2026.

**Dependencies:** Task 6

**Files likely touched:** `packages/engine/src/canonical-hash.ts`, `packages/evaluation/src/honest-worker.ts`, `packages/evaluation/src/metrics.ts`, `tests/engine/replay.test.ts`, `tests/policy/scoring.test.ts`

**Estimated scope:** Medium

## Task 8: Ship the offline replay game view

**Description:** Render the depot, worker/items, payout/useful counters, and an accessible event timeline from replay state.

**Acceptance criteria:**
- [x] The exploit is visually understandable without reading technical internals.
- [x] Play/pause, step, scrub, speed, jump-to-payout, keyboard controls, and text events work.
- [x] Reduced-motion disables cosmetic interpolation without changing results.

**Verification:** Three component tests pass. A real browser showed tick 7 at 10 paid points versus zero recycled, a clean console/accessibility tree, and no horizontal overflow at 320px or 1440px on October 26, 2026.

**Dependencies:** Task 7

**Files likely touched:** `apps/web/src/App.tsx`, `apps/web/src/depot/Depot.tsx`, `apps/web/src/replay/Timeline.tsx`, `apps/web/src/styles.css`, `tests/e2e/replay.spec.ts`

**Estimated scope:** Medium

## Task 9: Add manual policy inspection and patch comparison

**Description:** Let the player inspect supported semantics, activate immutable manual presets, and replay identical actions under a patch.

**Acceptance criteria:**
- [x] Draft edits never mutate an active run.
- [x] Old/new runs use the same root state/actions and separate reward ledgers.
- [x] The UI says an exploit stopped paying, not that the policy is safe.

**Verification:** Four component tests prove immutable original evidence, physical-state equivalence, separate ledgers, and truthful patch wording. A fresh Opera GX run replayed the same 11-action prefix at 30 original versus zero patched points with a clean console on October 26, 2026.

**Dependencies:** Task 8

**Files likely touched:** `apps/web/src/policy/PolicyEditor.tsx`, `apps/web/src/policy/PolicyDiff.tsx`, `apps/web/src/App.tsx`, `tests/e2e/patch-replay.spec.ts`

**Estimated scope:** Medium

## Checkpoint: Playable offline loop

- [x] A user can inspect the flawed rule, watch the exploit, patch, and replay without inference.
- [x] Browser console is clean and counters match host-derived fixtures.

## Task 10: Add the authoritative local run service

**Description:** Serve validated run creation/status/cancellation and ordered SSE events on localhost using the shared engine.

**Acceptance criteria:**
- [x] Live state is backend-owned and event IDs resume correctly after reconnect.
- [x] IDs and payload sizes are validated with one consistent error shape.
- [x] State-changing starts honor idempotency keys.

**Verification:** Three route integration tests cover identical/conflicting idempotent starts, cancellation without late actions, strict IDs, a 64 KiB body limit, and ordered SSE resume after `Last-Event-ID`. The 48-test suite, typecheck, production build, review mutation, and compiled localhost entry-point smoke test passed on October 27, 2026.

**Dependencies:** Task 7

**Files likely touched:** `apps/server/src/app.ts`, `apps/server/src/routes/runs.ts`, `apps/server/src/runs/service.ts`, `tests/server/runs.test.ts`

**Estimated scope:** Medium

## Task 11: Persist runs and recover safely

**Description:** Use Node's built-in synchronous SQLite API to persist policies, runs, events, payouts, actions, and idempotency claims transactionally.

**Acceptance criteria:**
- [x] Unique run/sequence and idempotency constraints are enforced atomically.
- [x] Restart marks unfinished inference interrupted and never repeats a paid request.
- [x] Foreign keys and transactions preserve complete replay evidence.

**Verification:** Two file-database integration tests persist a complete 7-action/11-event/1-payout trace, reject duplicate sequences and orphan actions, replay one atomic idempotency claim, and recover unfinished work as `interrupted` without restarting it. The full suite, typecheck, build, and recovery review mutation pass after clean installs on Node 22.18.0 and Node 24.14.1.

**Dependencies:** Task 10

**Files likely touched:** `apps/server/src/persistence/database.ts`, `apps/server/src/persistence/schema.ts`, `apps/server/src/runs/service.ts`, `tests/persistence/database.test.ts`

**Estimated scope:** Medium

## Task 12: Add safe configuration and usage reservations

**Description:** Validate server environment settings and reserve/settle bounded provider usage with live calls disabled by default.

**Acceptance criteria:**
- [x] Missing credit confirmation or budget keeps live mode off.
- [x] Reservations are serial/atomic; ambiguous timeouts retain worst-case cost.
- [x] Health/usage responses never expose secrets.

**Verification:** Four provider-budget tests cover fail-closed configuration, upward microdollar rounding, concurrent atomic reservation, ambiguous-timeout retention, settlement, and secret-free health/usage responses. The 54-test suite, typecheck, build, high-severity audit, ambiguity review mutation, and redacted real `.env` readiness check passed on October 27, 2026.

**Dependencies:** Task 11

**Files likely touched:** `apps/server/src/config.ts`, `apps/server/src/budget/service.ts`, `apps/server/src/routes/usage.ts`, `tests/provider/budget.test.ts`

**Estimated scope:** Medium

## Task 13: Translate natural-language policies with Meta

**Description:** Add the server-only Meta adapter and schema-constrained translation, preserving literal omissions and unrelated patch semantics.

**Acceptance criteria:**
- [x] Manual and model output pass the identical strict validator.
- [x] Ambiguous/unsupported results cannot activate.
- [x] No credential, prompt injection, or executable code reaches engine logic.

**Verification:** Five fixture/route tests cover the documented Meta request, strict host validation, non-candidate refusal, paid-call idempotency, single-request concurrency, truncated output, and ambiguous timeout accounting. An authorized live `muse-spark-1.3` call produced the expected every-deposit candidate and host-validated it at $0.004982 actual cost; the ledger conservatively retains $0.004075 from the earlier unverifiable response, leaving at least $9.990943 of the $10 app cap. The 59-test suite, typecheck, build, high-severity audit, and activation review mutation passed on October 27, 2026.

**Dependencies:** Task 12

**Files likely touched:** `apps/server/src/providers/meta.ts`, `apps/server/src/routes/policies.ts`, `packages/policy/src/interpret.ts`, `tests/provider/translation.test.ts`

**Estimated scope:** Medium

## Task 14: Run a bounded attacker and independently verify candidates

**Description:** Expose only inspect/act/reset/submit/conclude tools, enforce all host limits, and replay submitted actions from the immutable root.

**Acceptance criteria:**
- [x] Unknown/duplicate/late/over-limit tool calls are rejected.
- [x] Narrative without actions cannot verify an exploit.
- [x] Final status and evidence come only from host replay.

**Verification:** Five adversarial host tests reject unknown, duplicate, late, oversized, excess-trial, timed-out, and post-cancellation work; a recorded two-turn Meta fixture verifies the documented Chat Completions tool loop and durable budget settlement. An authorized live `muse-spark-1.3` search used 10 bounded requests and $0.070258 in raw token cost ($0.070261 conservatively rounded in the ledger), submitted 13 actions, and was independently replayed as 30 excess points, zero recycled items, two rejected actions, and three payout receipts. Search `attacker-live-v2`, all 10 turns, run `74e918a0-786b-4046-b415-9de2e665a6df`, exact actions, 19 ordered events, and three payouts were persisted on October 27, 2026. The full 66-test suite, typecheck, build, high-severity audit, and durable row-count audit passed.

**Dependencies:** Task 13

**Files likely touched:** `apps/server/src/runs/agent.ts`, `apps/server/src/runs/verifier.ts`, `prompts/attacker-v1.txt`, `tests/adversarial/agent.test.ts`

**Estimated scope:** Medium

## Task 15: Add Policy Lab, branching, and portable export

**Description:** Expose structured diffs, receipts, same/different-policy branching rules, and a hash-verified replay export.

**Acceptance criteria:**
- [x] Same-policy branches inherit both ledgers; changed-policy branches reconstruct the prefix.
- [x] Exported runs replay offline and reject corruption/version mismatch.
- [x] Every run displays provenance and actual search limits.

**Verification:** Branch/persistence tests prove same-policy reward/outcome inheritance and changed-policy prefix reconstruction. Route tests cover branch, replay-under-policy, and export endpoints; portable export tests reject payload corruption and engine-version mismatch. The persisted live run was migrated to `live_model` provenance with exact `muse-spark-1.3` limits and exported as `artifacts/attacker-live-v2.json`, which self-verified before writing. Policy Lab component tests and an Opera GX pass show the exact clause diff, receipt audit, scripted provenance, zero inference requests, and 120-tick limit; the console was clean and the 320 px document width matched the viewport on October 27, 2026.

**Dependencies:** Tasks 11 and 14

**Files likely touched:** `apps/web/src/policy/PolicyLab.tsx`, `apps/server/src/routes/exports.ts`, `scripts/export-run.ts`, `tests/persistence/export.test.ts`, `tests/e2e/policy-lab.spec.ts`

**Estimated scope:** Medium

## Task 16: Evaluate, polish, and prepare submission evidence

**Description:** Run offline families/seeds/baselines, record honest results, finish accessibility/usability checks, and prepare README/demo/submission artifacts.

**Acceptance criteria:**
- [x] Required commands work from a clean clone and incomplete results say “not run.”
- [x] Evaluation reports raw numerators/denominators, costs, limits, and replay agreement.
- [x] Three-minute script, attribution, setup, license decision, and judge-access checklist are reviewable.

**Verification:** Clean `npm ci`, 71 tests, strict typecheck, production build, offline evaluation, and high-severity audit pass on Node 22.18.0 and Node 24.14.1. The generated scorecard records three honest orders, two adversarial families, raw 0/6–6/6 coverage, 0/60–30/60 excess, deterministic replay agreement, and exact live limits/tokens/cost. README, attribution, explicit no-license decision, three-minute script, and judge checklist are reviewable. Volunteer usability, public deployment, incognito access, video recording, publication, and submission remain explicitly “not run” or “not performed.”

**Dependencies:** Task 15

**Files likely touched:** `scripts/evaluate.ts`, `docs/evaluation.md`, `docs/demo-script.md`, `docs/submission-checklist.md`, `README.md`

**Estimated scope:** Medium

## Checkpoint: Complete

- [x] Core flow works end to end with truthful provenance.
- [x] At least one authorized live Meta trace is independently verified or explicitly reported as not run/failed.
- [x] No secrets are tracked and no paid/public action occurred without authorization.

## Task 17: Expand into a judge-facing red-team arena

**Description:** Connect the existing translation, attacker, replay, patch, and evaluation systems into one browser workflow with an offline evidence fallback.

**Acceptance criteria:**
- [x] A user can submit plain English, review Meta's bounded candidate, and explicitly activate it.
- [x] A live Muse attack is idempotent, durable, host-verified, and loadable as an exact replay.
- [x] The active and patched policies show separate honest-workflow and known-failure counts without a composite safety score.
- [x] Recorded live evidence remains demoable without making a paid request.

**Verification:** Route/service tests cover durable attack creation and idempotent replay. UI tests cover translation/activation, the live attack/export flow, exact recorded evidence, patch comparison, and the deterministic policy gauntlet. In Opera GX, the vague rule was refused, an explicit candidate required activation, and a browser-launched `muse-spark-1.3` search used 11 requests/$0.082180 to produce a 17-action host-verified trace worth 20 reward and zero useful items; the eligible-processing patch paid zero on the replayed trace. The portable export is `artifacts/attacker-live-arena.json`. The 77-test suite, strict typecheck, production build, high-severity audit, and post-fix browser console check pass on October 27, 2026.

**Dependencies:** Tasks 13–16

**Files likely touched:** `apps/server/src/runs/live-attack-service.ts`, `apps/server/src/app.ts`, `apps/web/src/arena/`, `apps/web/src/policy/PolicyGauntlet.tsx`, `tests/server/live-attacks.test.ts`, `tests/web/replay.test.tsx`

## Task 18: Prove the attack-patch-reattack loop

**Description:** Make the central claim visible and testable: the first patch removes duplicate rewards but leaves eligibility/completion failures, while the stronger patch survives disclosed regression cases and a separate bounded search.

**Acceptance criteria:**
- [x] Original, once-per-item, and eligible-processing policies report 0/3, 1/3, and 3/3 known failures blocked while preserving 3/3 honest workflows.
- [x] Selecting a patch makes that exact policy the next fresh Muse target and activates the attacked policy when its trace loads.
- [x] Policy interpretation exposes trigger, eligibility, repetition, and completion assumptions before activation.
- [x] Recorded replay, regression cases, and fresh searches remain distinctly labeled.

**Verification:** A fresh `muse-spark-1.3` run against the once-per-item patch verified an ineligible-item payout of 10 points with zero useful recycling in 8 requests/$0.052854; run `21d24ea4-6cba-4481-a5f0-2698cf025841` is exported at `artifacts/attacker-once-per-item.json`. A separate 12-request/$0.098851 search against the eligible-processing patch concluded with no exploit found within budget. The first once-per-item attempt observed the reward but failed to submit before its 12-request/$0.092949 limit; the attacker now receives turn-budget reminders and the targeted provider test proves that instruction. Opera GX showed the 3/3→1/3→3/3 progression, patch-specific fresh-attack labels, recorded-run provenance, and a clean console. Graphify produced 528 nodes, 1,476 edges, 19 labeled communities, and a 21.8× token-reduction benchmark; its report preserves the edge-collapse health warning. The 79-test suite, strict typecheck, production build, and high-severity audit pass. Total settled Meta usage is $0.481384 with $9.514541 of the authorized app cap remaining.

**Dependencies:** Task 17

**Files likely touched:** `apps/web/src/arena/`, `apps/web/src/policy/PolicyGauntlet.tsx`, `apps/server/src/providers/meta-attacker.ts`, `tests/web/`, `tests/provider/meta-attacker.test.ts`, `docs/demo-script.md`

## Task 19: Audit and polish the judge-facing interface

**Description:** Apply an Impeccable technical audit without changing Fine Print's editorial/industrial identity.

**Acceptance criteria:**
- [x] The complete workflow sits inside one main landmark and the selected timeline event is exposed to assistive technology.
- [x] Phone layouts preserve the title/tagline hierarchy without clipping or horizontal document overflow.
- [x] Interactive controls meet a 44 px touch floor and retain visible focus, hover, disabled, and reduced-motion states.
- [x] Template-like side accents are replaced without weakening pass/fail or evidence hierarchy.

**Verification:** The audit improved the technical score from 15/20 to 18/20. Opera GX passes at 320 px and 1440 px with no document overflow, no sub-44 px controls, one complete main landmark, correct `aria-current` state, and no app-origin console errors. Impeccable's detector findings were resolved except its decorative-grid advisory, which is intentional because the grid is the actual 9×7 depot. The 80-test suite, strict typecheck, production build, and high-severity audit pass on October 27, 2026.

**Files touched:** `apps/web/src/App.tsx`, `apps/web/src/replay/EventTimeline.tsx`, `apps/web/src/styles.css`, `tests/web/replay.test.tsx`

## Task 20: Close reviewer trust gaps and add a 3D live depot

**Description:** Fix contradictory policy summaries, distinguish each live attack attempt from loaded replay evidence, explain honest-work expectations, compress the judge-facing opening, and render the deterministic depot in 3D.

**Acceptance criteria:**
- [x] Candidate and active-policy summaries report material, eligibility, trigger, repetition, and reward constraints independently.
- [x] Inconclusive searches show their own target, provenance, and outcome without replacing or impersonating loaded replay evidence.
- [x] Every honest workflow reports the 60-point reference expectation beside its actual payout and explains that a narrower custom policy is not inherently invalid.
- [x] The live depot uses an isometric 3D stage while retaining the existing deterministic DOM state and screen-reader description.
- [x] The desktop arena is compact enough to reveal the simulator in the opening viewport.

**Verification:** The reviewer's seven-point aluminium policy reproduces as `aluminium`, `+7`, and 21 actual points against the clearly labeled 60-point reference. An inconclusive eligible-processing search is regression-tested beside previously loaded verified evidence. Opera GX shows live agent movement on the isometric depot at tick 1, no app-origin console errors, no horizontal overflow at 320, 768, or 1024 px, and the simulator entering the 1024 px opening viewport. The 82-test suite, strict typecheck, production build, and high-severity audit pass on October 27, 2026. No paid inference request was made for this task.

**Files touched:** `apps/web/src/arena/PolicyComposer.tsx`, `apps/web/src/arena/RedTeamArena.tsx`, `apps/web/src/depot/Depot.tsx`, `apps/web/src/policy/PolicyCard.tsx`, `apps/web/src/policy/PolicyGauntlet.tsx`, `apps/web/src/styles.css`, `tests/web/policy-gauntlet.test.ts`, `tests/web/replay.test.tsx`

