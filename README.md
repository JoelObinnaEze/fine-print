# Fine Print

Fine Print helps teams test reward rules before launch. A rule can pay exactly what it says while rewarding behavior its author never intended. Meta Muse translates plain language and searches for failure cases; deterministic host code validates every transaction, payout, and final claim.

The primary workbench investigates a referral-credit programme across purchases, promotional credit, returns, and refunds. It separates the written rule from the intended business outcome, reduces a confirmed failure to its shortest proof, and compares repairs by customer delay and legitimate rewards preserved. Bottle Return demonstrates the same proposal-versus-verification boundary in a 3D recycling system.

- **Live judge build:** [joelobinnaeze.github.io/fine-print](https://joelobinnaeze.github.io/fine-print/)
- **60-second judge path:** [docs/judge-guide.md](docs/judge-guide.md)
- **Three-minute recording package:** [script](docs/demo-script.md) · [production plan](docs/demo-production-plan.md)

## Verified result

- A live `muse-spark-1.3` commerce investigation proposed four transactions; the host reduced them to the three required steps and verified `$20` spendable referral credit against `$0` retained revenue. The call cost `$0.013197`.
- Muse proposed three materially different repairs. A separate five-action recheck spent `$10` of reward before refund; the strengthened verifier now counts that reversal debt as `$10` of unrecovered value and rejects immediate reversal. **Pay after return window** is the recommended tested repair: `$0` reward value exposed, `$20` honest reward preserved, and a disclosed 30-day wait.
- Confirmed commerce cases are now stored against the exact source-policy and tested-repair hashes. Every repair is replayed against the accumulated applicable cases; the recommendation uses the highest observed exposure, and a later miss cannot erase an earlier confirmed failure. Exposure is always labelled as observed under tested cases, not a guaranteed maximum.
- A fresh repair recheck now loads the selected structured policy directly from its evidence set and asks Muse only for transactions. A systematic bounded action search supplements the proposal and is labelled separately. In the reviewer’s `$11` / `$45` / 7-day scenario, the recheck found `$11` of unrecovered spent credit, raised that repair’s exposure, and changed the recommendation; the stronger repair then completed a 2,610-state bounded search with no verified failure.
- The commerce population view reports ordinary customers, bargain hunters, and coordinated adversaries under disclosed deterministic assumptions. It is not a forecast of real fraud rates.
- The scripted trace pays 30 points for one bottle deposited three times while recycling zero items.
- A browser-launched `muse-spark-1.3` search independently found a second loophole: two ineligible items earned 20 points while recycling zero items. It used 11 requests, submitted 17 valid actions, and cost $0.082180.
- The once-per-item patch removes repeat rewards but still fails on eligibility and completion: the disclosed gauntlet preserves 3/3 honest workflows while blocking only 1/3 known failures. A fresh Muse search verified an ineligible-item payout of 10 points with zero useful recycling in 8 requests at $0.052854.
- The eligible-processing patch preserves 3/3 honest workflows and blocks all 3 disclosed failures. A separate 12-request Muse search found no failure within its bounded budget at $0.098851; that is evidence from one search, not a proof of safety.
- The designed batch benchmark pays 15 points for cycling a transient three-item hopper while doing zero useful processing. Its receipt-backed patch pays zero on that trace while preserving 35 points for one honest batch and 70 for two.
- In the frozen discovery suite, Muse found the premature-deposit flaw 2/2 and the interacting batch flaw 1/2, with no confirmed failure in 4/4 blocked-control runs. The simple beam-search baseline found both flaws 3/3 and both controls 0/3; every attempt remains in the report.
- The versioned `fine-print-eval-v4` suite expands this to six designed failure/control pairs (12 cases) across repeated deposits, ineligible material, transient batch bonuses, refund-retained credit, spent-before-reversal credit, and promotional-credit qualification. All 12 deterministic reference replays matched their frozen labels and preserved their stated honest behavior. Validated starting states let the live evaluator run the promotional-credit pair. The separate six-case interpretation matrix passed 6/6; every miss, invalid sequence, provider interruption, and mapping mismatch remains visible.
- An earlier live trace independently replayed 13 submitted actions as 30 excess points, zero recycled items, two rejected actions, and three payout receipts at $0.070258.
- Confirmed failures can be saved as durable SQLite regression cases and are replayed automatically against the selected policy.
- [artifacts/commerce-investigation-live.json](artifacts/commerce-investigation-live.json) and [artifacts/commerce-repair-live.json](artifacts/commerce-repair-live.json) preserve the original live runs; [artifacts/commerce-repair-reverified.json](artifacts/commerce-repair-reverified.json) records the corrected deterministic verdict without making a new model call. [artifacts/evaluation.json](artifacts/evaluation.json) contains the offline and frozen live evaluation.

These are observations from bounded traces, not a proof that a policy is safe.

## Run locally

Requirements: Node.js 22.18.0 or newer and npm 11. The repository pins the oldest verified runtime, `22.18.0`, in `.nvmrc`; run `nvm use 22.18.0` first when using nvm.

```bash
npm ci
cp .env.example .env
npm test
npm run typecheck
npm run build
npm run dev
```

Node 22 and Node 24 are both verified. Persistence uses Node's built-in synchronous SQLite API, so a clean install does not require a native compiler or Visual Studio C++ tools.

Open `http://127.0.0.1:5173`. On PowerShell, use `Copy-Item .env.example .env` instead of `cp`. Start the API in a second terminal before using live translation or attack buttons; the Vite development server proxies `/api` to port 8787.

The local API runs at `http://127.0.0.1:8787`:

```bash
npm run start:server
```

Live calls are disabled in `.env.example`. To enable them, add your Meta key to the untracked `.env`, confirm available event credits, and set positive app/session/search caps. The usable app allowance keeps the larger of $1 or 10% in reserve. The server serializes provider calls, reserves worst-case usage before each request, and retains ambiguous reservations after unverifiable outcomes.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run deterministic, property, route, provider-fixture, persistence, and UI tests. |
| `npm run typecheck` | Run strict TypeScript checks. |
| `npm run build` | Build server scripts and the production web bundle. |
| `npm run evaluate` | Regenerate the offline scorecard without inference. |
| `npm run benchmark:discovery` | Replay or, when absent, run the eight idempotent paid Muse attempts in the frozen suite. Requires explicit authorization and enabled budgets. |
| `npm run benchmark:frozen` | Fill up to three idempotent live attempts for each `fine-print-eval-v4` case without changing configured caps. |
| `npm run benchmark:interpretation` | Run the six idempotent interpretation-only cases separately from transaction discovery. |
| `npm run check:meta` | Verify the configured Meta account/model catalog without inference. |
| `npm run smoke:meta-translation` | Run the idempotent paid translation smoke test when authorized. |
| `npm run smoke:meta-attacker` | Run the one-shot bounded paid attacker search when authorized. The checked-in search ID cannot be sent twice. |
| `npm run export:run -- <run-id> <path>` | Write a new, hash-verified replay export without overwriting an existing file. |

## Architecture and trust boundary

```text
Meta policy/action proposal
          │ untrusted JSON/tool calls
          ▼
strict schemas → host limits → deterministic engine → payout/oracle replay
                                           │
                                           ▼
                         SQLite evidence + hash-verified export
```

The model never receives credentials, filesystem access, database handles, hidden evaluation cases, or policy-write tools. It cannot set success. Candidate actions are discarded from mutable trial state and replayed from the immutable root before the host emits a verdict.

## Evidence and project status

- [Evaluation report](docs/evaluation.md)
- [Three-minute demo script](docs/demo-script.md)
- [Demo production plan](docs/demo-production-plan.md)
- [Paste-ready submission copy](docs/submission-copy.md)
- [One-minute judge guide](docs/judge-guide.md)
- [Honest usability protocol](docs/usability-protocol.md)
- [Competition expansion brief](docs/ideas/red-team-arena.md)
- [Opera GX verification capture](artifacts/opera-fine-print.png)
- [Opera GX commerce workbench](artifacts/opera-commerce-workbench.png)
- [Opera GX selected-repair verdict](artifacts/opera-commerce-repair.png)
- [Submission and judge-access checklist](docs/submission-checklist.md)
- [Implementation ledger](tasks/todo.md)
- [Original build brief](creation.md)

The public judge build is a static, deterministic replay with no key or paid endpoint in the browser. Live Muse requests remain local and budget-capped. Video recording, usability participants, portal submission, and legal acceptance still require human action.

## Attribution and license

Fine Print uses React, Vite, TypeScript, Zod, Node SQLite, Vitest, Testing Library, and fast-check. The interface uses repository-authored CSS and SVG-like CSS shapes; no purchased or generated art is included. Meta Model API integration follows the official [Chat Completions](https://dev.meta.ai/docs/protocols/chat-completions), [tool calling](https://dev.meta.ai/docs/tool-calling), [structured output](https://dev.meta.ai/docs/structured-output), [reasoning](https://dev.meta.ai/docs/reasoning), and [pricing](https://dev.meta.ai/docs/pricing-rate-limits) documentation.

No open-source license has been selected and no `LICENSE` file is present. By default, the repository is not licensed for reuse; choose a license before publishing if reuse is intended.
