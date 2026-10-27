# Red-Team Arena expansion brief

## Problem

How might an agent builder turn a vague incentive into a reproducible failure and a regression-tested patch without trusting the model's own claim that it succeeded?

The original replay was technically sound but looked like one prepared example. Competition judges need to see Meta create material value in the central loop, a failure they can understand in seconds, and evidence that survives the demo.

## Chosen direction

Fine Print is now a red-team arena:

1. A user writes a plain-English incentive.
2. Meta proposes a candidate in a small executable policy language.
3. The user explicitly activates the reviewed candidate.
4. Muse searches through bounded inspect/act/reset/submit tools.
5. The host replays the exact trace, generates payout receipts, and records usage.
6. A patch replays the same actions and runs through an honest/adversarial gauntlet.

This follows the strongest pattern in prior Meta hackathon winners: a legible real-world problem, a model-produced domain artifact, and an immediately visible result. It also makes specification gaming—the gap between a written objective and the intended outcome—the product experience rather than background theory.

## Other directions considered

- Multi-world policy platform: broader, but it would dilute the bottle-return demo and multiply untested rules.
- Multimodal policy ingestion: visually impressive, but Muse text/tool integration is more central to the current proof.
- Public exploit leaderboard: social, but requires deployment, identity, moderation, and abuse controls.
- Autonomous patch generation: tempting, but the bounded DSL plus explicit human activation is more credible and safer.

## Scope and claims

The implemented scope is one deterministic world, one bounded policy language, a live attacker, exact replay/export, manual patches, and a three-case gauntlet. It does not claim formal verification or universal policy safety. Scores describe only the disclosed honest workflow and adversarial traces.

## Research anchors

- [Meta Global AI Developer Hackathon](https://events.cerebralvalley.ai/e/meta-ai-developer-hackathon): creativity, technical ambition, and a working demo.
- [Meta developer hackathon hub](https://dev.meta.ai/events/global-hackathon): official event and tooling context.
- [LlamaCon hackathon winners](https://ai.meta.com/blog/llamacon-hackathon/): clear problems transformed into useful, inspectable artifacts.
- [Llama 3 hackathon recap](https://ai.meta.com/blog/llama-3-hackathon-recap-cerebral-valley/): domain-specific workflows and visible outcomes.
- [Specification gaming](https://deepmind.google/blog/specification-gaming-the-flip-side-of-ai-ingenuity/): why optimizing the written reward can violate intent.
- [AI safety in simple environments](https://deepmind.google/blog/specifying-ai-safety-problems-in-simple-environments/): why small deterministic worlds are useful test beds.
