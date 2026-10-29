# Paste-ready submission copy

Use the exact field names shown in the participant portal. This is a copy bank, not a substitute for reviewing the final form.

## Identity

**Project name:** Fine Print

**Tagline:** Test reward rules before they reward the wrong behaviour.

**Track:** Indie developer

**Theme:** Push the Frontier

**Relevant bonus:** Best Agentic Use-Case

## Short description

Fine Print asks Meta Muse to find ways an incentive rule can pay for the wrong outcome, then independently replays every proposed action in deterministic simulators. Policy owners receive inspectable evidence, competing repairs, and permanent regression checks without trusting the model to grade its own work.

## Full description

Reward programmes often fail even when the implementation matches the written policy exactly. A referral rule can keep credit after a refunded purchase; a recycling rule can pay before processing occurs. Fine Print turns that gap between written rules and intended outcomes into an executable test.

A policy owner supplies the reward rule, the business outcome that must remain true, and the honest-user promise that a repair should preserve. Meta Muse maps the language into a supported simulator, proposes concrete transaction sequences through bounded tools, and generates competing repairs. Strict host schemas validate every call. Deterministic simulators alone execute transactions, calculate payouts, minimize successful traces, and decide the final result.

The primary commerce workbench demonstrates a real Muse run that reduced four proposed actions to three and confirmed twenty dollars of spendable referral credit against zero retained revenue. A separate Muse recheck of the recommended refund-reversal repair produced zero payout without lasting value while preserving the full honest reward with no delay. The Bottle Return lab demonstrates the same proposal-versus-verification boundary in a three-dimensional recycling environment.

Every run records provenance, limits, actions, tokens, cost, and host observations. Confirmed traces can become permanent regression checks. A frozen evaluation reports all repeated attempts and compares Muse with a deterministic search baseline rather than selecting only successful examples.

## How Meta AI is essential

Muse performs the open-ended work that fixed tests cannot: interpreting unfamiliar policy wording, forming hypotheses about interacting clauses, proposing executable sequences, and generating repairs with different business tradeoffs. Fine Print deliberately does not let Muse set scores, modify policies, or declare success. The model proposes; deterministic host code verifies.

## Technical execution

- Meta Model API with structured output and bounded tool calling
- Strict Zod validation at every model and HTTP trust boundary
- Pure TypeScript commerce and recycling simulators
- Trace minimization and independent replay from immutable initial state
- SQLite persistence with idempotent run creation and budget reservation
- Durable regression cases and hash-verified portable artifacts
- Frozen repeated-run evaluation against a simple action-search baseline
- React interface with keyboard-accessible step navigation and a 3D CSS replay

## Verified results

- Commerce: 4 Muse-proposed transactions reduced to 3; `$20` reward remained after refund while retained revenue was `$0`.
- Commerce repair: a separate 5-action Muse recheck produced `$0` unintended payout while preserving `$20` honest reward with no delay.
- Bottle Return: Muse found premature deposit payment in 2/2 runs and an interacting batch failure in 1/2 runs.
- Blocked controls: no confirmed failure in 4/4 bounded Muse runs.
- All attempts, including unsuccessful ones, are preserved in `artifacts/evaluation.json`.

## Limitations

Fine Print evaluates only the behaviours represented by its simulators and the bounded searches that were run. A search that finds no failure is evidence from that attempt, not proof of safety. The population examples are deterministic strategy traces, not forecasts of real customer behaviour.

## Links

- Live demo: `https://joelobinnaeze.github.io/fine-print/`
- Source: `https://github.com/JoelObinnaEze/fine-print`
- Demo video: **add after upload**

## Built during the event

The Fine Print application, both simulators, Meta integrations, replay and verification pipeline, evaluation suite, interface, documentation, and submission assets were created during the permitted hackathon build period. Planning notes written before implementation are retained separately and are not presented as shipped code.
