# Implementation Plan: Fine Print

## Overview

Build one polished Bottle Return scenario as a sequence of working vertical slices. The dependency order—not the eight-day example timeline—controls implementation: deterministic evidence first, then the game view, then server persistence, then paid-model features behind disabled-by-default budget controls.

The user supplied and approved the detailed requirements in `creation.md` and explicitly asked for planning followed by implementation. The October 27–November 3 schedule is guidance only.

## Capability map

| Module | Responsibility | Depends on |
| --- | --- | --- |
| `engine` | Immutable world state, legal actions, deterministic transitions, hashes | — |
| `policy` | Strict declarative reward rules and payout receipts | `engine` events |
| `evaluation` | Independent outcome oracle, honest worker, leakage metrics | `engine`, `policy` |
| `replay-ui` | Depot view, timeline, policy inspection, counterfactual replay | `engine`, `policy`, `evaluation` |
| `run-service` | Authoritative runs, SSE, persistence, recovery | `engine`, `policy` |
| `meta-provider` | Translation and bounded attacker calls with budget reservations | `run-service` |
| `policy-lab` | Version comparison, branching, export, technical evidence | all above |

Build order: `engine` → `policy` → `evaluation` → `replay-ui` → `run-service` → `meta-provider` → `policy-lab`.

## Architecture decisions

- Use Node.js 22.23.4 or newer with npm workspaces and strict ESM TypeScript so browser and server share contracts without a build-time code generator.
- Model actions and loci as discriminated unions; item identity and locus remain authoritative engine facts.
- Keep `step(state, action, policy, engineVersion)` pure and return a new state plus host-derived events and payouts.
- Use canonical JSON plus SHA-256 for replay hashes; object keys sort recursively and array order remains significant.
- Treat the backend as authoritative for live runs; the browser may replay the same pure engine for offline viewing.
- Keep Meta Model API server-only and off by default. Model output is untrusted and must pass the same validators as manual input.
- Use pinned `better-sqlite3` 13.0.3 for persistence. Its bundled N-API build passed file reopen, transaction rollback, and foreign-key checks on Node 22.23.4 and Node 24.14.1.
- Use simple repository-owned SVG/CSS art. No generated art or additional scenario until the full core loop works.

## Thin-slice sequence

1. Repository and TypeScript test foundation.
2. Bottle Return state/action contracts and seeded initial world.
3. Deterministic action execution for the deposit/retrieve exploit path.
4. Reward policy receipts and independent recycling oracle.
5. Canonical hashes, property invariants, and honest-worker metrics.
6. Offline playable replay UI with counters and event timeline.
7. Policy inspection, presets, patch replay, and old/new comparison.
8. Authoritative local run server, SSE, and persistence.
9. Disabled-by-default Meta translation with strict output validation and budget accounting.
10. Bounded attacker tools plus independent final verification.
11. Policy Lab branching/export, evaluation runner, E2E flow, and submission evidence.

## Current slice scope

The first implementation slice reaches package configuration, engine exports, the Bottle Return fixture, and focused tests. It does not reach the UI, server, persistence, or Meta API. It cannot spend money or expose the configured key. The main compatibility risk is committing to public engine shapes too early, so tests lock only the required observable contracts.

## Verification checkpoints

- Engine checkpoint: unit/property tests, typecheck, build, and deterministic trace hash.
- Playable checkpoint: browser runtime check, reduced-motion/keyboard check, and backend-derived counters.
- Live-agent checkpoint: contract smoke test only after user-confirmed credits and budget; no automatic retry on ambiguous paid failures.
- Completion checkpoint: clean install, full test/build/E2E/evaluation commands, replay export verification, and judge-access rehearsal.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Reward logic accidentally affects physics | High | Separate engine events, policy receipts, and outcome oracle; compare physical hashes under policy changes. |
| Model fabricates an exploit | High | Accept only explicit actions and replay from the saved root state in host code. |
| Secret or paid call leaks into client/tests | High | Ignore `.env`, server-only adapter, live disabled and budget zero by default. |
| Overbuilding prevents a polished core loop | High | One world, one core exploit, no extra art/frameworks/features before end-to-end proof. |
| Runtime/native database mismatch | Low | Require Node 22.23.4+, pin `better-sqlite3` 13.0.3, and keep the cross-runtime database smoke test. |
| A patch is presented as universally safe | Medium | UI copy reports stopped traces and bounded searches, never global safety. |

## Open questions deferred without blocking the core

- License choice before the repository becomes public.
- Hosting/access method for judges.
- Confirmed usable event credits and explicit project/session/search budgets.
- A valid Meta Model API credential; the configured key reached the official endpoint but returned HTTP 401 on October 26, 2026.

