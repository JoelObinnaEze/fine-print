# Fine Print

Fine Print is a bounded recycling-depot game about specification gaming. A policy can pay exactly what it says while rewarding behavior its author did not intend. Meta translates plain language and searches for candidate traces; deterministic host code validates every policy, action, payout, and final claim.

The current local build demonstrates the core loop: inspect a flawed deposit rule, replay a repeated-deposit exploit, compare immutable policy patches, inspect exact receipts, and audit a separately recorded live Meta search.

## Verified result

- The scripted trace pays 30 points for one bottle deposited three times while recycling zero items.
- The persisted live `muse-spark-1.3` trace independently replayed 13 submitted actions as 30 excess points, zero recycled items, two rejected actions, and three payout receipts.
- That live search used 10 requests, 47,584 input tokens, 2,536 output tokens, and $0.070258 in raw token cost.
- The portable live trace is [artifacts/attacker-live-v2.json](artifacts/attacker-live-v2.json); [artifacts/evaluation.json](artifacts/evaluation.json) contains the reproducible offline scorecard.

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

Open `http://127.0.0.1:5173`. On PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

The local API runs at `http://127.0.0.1:8787`:

```bash
npm run start:server
```

Live calls are disabled in `.env.example`. To enable them, add your Meta key to the untracked `.env`, confirm available event credits, and set positive app/session/search caps. The server still serializes provider calls, reserves worst-case usage before each request, and retains ambiguous reservations after unverifiable outcomes.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run deterministic, property, route, provider-fixture, persistence, and UI tests. |
| `npm run typecheck` | Run strict TypeScript checks. |
| `npm run build` | Build server scripts and the production web bundle. |
| `npm run evaluate` | Regenerate the offline scorecard without inference. |
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
- [Submission and judge-access checklist](docs/submission-checklist.md)
- [Implementation ledger](tasks/todo.md)
- [Original build brief](creation.md)

The application is local-only. Public deployment, repository publication, video recording, usability participants, hackathon submission, and legal acceptance have not been performed.

## Attribution and license

Fine Print uses React, Vite, TypeScript, Zod, Node SQLite, Vitest, Testing Library, and fast-check. The interface uses repository-authored CSS and SVG-like CSS shapes; no purchased or generated art is included. Meta Model API integration follows the official [Chat Completions](https://dev.meta.ai/docs/protocols/chat-completions), [tool calling](https://dev.meta.ai/docs/tool-calling), [structured output](https://dev.meta.ai/docs/structured-output), [reasoning](https://dev.meta.ai/docs/reasoning), and [pricing](https://dev.meta.ai/docs/pricing-rate-limits) documentation.

No open-source license has been selected and no `LICENSE` file is present. By default, the repository is not licensed for reuse; choose a license before publishing if reuse is intended.
