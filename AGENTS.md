# Fine Print contributor rules

## Product

Fine Print is a bounded recycling-depot game about specification gaming. Meta proposes policies and actions; deterministic host code validates and executes them. The source specification is `creation.md`; current work is tracked in `tasks/todo.md`.

## Stack and commands

- Node.js 22.23.4 or newer, npm workspaces, strict TypeScript, ESM.
- Tests: Vitest; property tests: fast-check; browser tests: Playwright when the UI exists.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run dev`.
- Meta auth/catalog probe: `npm run check:meta` (no inference request).

## Conventions

- Prefer named exports and discriminated unions.
- Keep the engine pure: no network, database, wall clock, random IDs, or animation timing.
- Validate only at trust boundaries; internal functions consume validated types.
- Tests describe observable behavior and are written before non-trivial logic.
- Keep each task small and update `tasks/todo.md` with verification evidence.

## Boundaries

- Never commit or print `.env`, API keys, private data, or chain-of-thought.
- Never execute model-generated code or let model output decide rewards or verification.
- Live inference and spending remain disabled by default until the user confirms usable credits and a budget.
- Do not publish, deploy, submit, accept terms, or make purchases without direct user authorization.
- Do not claim a trace proves global policy safety; report only what host replay verified.

