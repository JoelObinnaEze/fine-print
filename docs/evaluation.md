# Evaluation report

Status: completed locally on October 27, 2026. The machine-readable source is [`artifacts/evaluation.json`](../artifacts/evaluation.json).

## Offline matrix

One deterministic Bottle Return seed was evaluated with three complete honest-worker orders and two adversarial trace families per policy. Offline evaluation made zero inference requests and cost $0.

| Policy | Honest items paid exactly 10 | Max observed excess / 60 | Traces | Tested policy score |
| --- | ---: | ---: | ---: | ---: |
| No rewards | 0 / 6 | 0 / 60 | 3 honest + 2 adversarial | 0 |
| Every deposit | 6 / 6 | 30 / 60 | 3 honest + 2 adversarial | 50 |
| Once per item at deposit | 6 / 6 | 10 / 60 | 3 honest + 2 adversarial | 83 |
| Eligible item processing | 6 / 6 | 0 / 60 | 3 honest + 2 adversarial | 100 |

The score is `round(100 × minimum honest coverage × (1 − maximum observed leakage))`. It is a transparent game heuristic over this test set, not a standardized safety metric. A score of 100 means only that these five traces did not expose leakage.

The adversarial families were repeated deposit/retrieve and ineligible rubbish processing. Every replay hash agreed across two independent executions. Raw rewards, useful items, contamination, excess, leakage, action counts, and hashes are preserved in the JSON artifact.

## Live Meta evidence

The persisted `muse-spark-1.3` search is labelled `live_model` and used the Standard model variant.

| Quantity | Observed |
| --- | ---: |
| Provider requests | 10 / 12 |
| Input tokens | 47,584 |
| Output tokens | 2,536 |
| Total tokens | 50,120 |
| Raw token cost | $0.070258 |
| Submitted actions | 13 |
| Invalid engine actions preserved | 2 |
| Reward | 30 points |
| Useful recycled items | 0 |
| Excess reward | 30 points |
| Leakage | 30 / 60 = 0.5 |

The per-request ledger rounds cost upward to microdollars, so this trace consumed $0.070261 against the cap. Across the successful live translation, two bounded attacker searches (the first preceded durable turn storage), and one ambiguous earlier translation response, the ledger conservatively counts $0.149575 and leaves at least $9.850425 of the authorized $10 app cap.

## Not run

- Volunteer usability study: **not run**; participants = 0.
- Public deployment/incognito judge access: **not run**.
- Cross-seed scenario evaluation: **not run**; Bottle Return currently has one named deterministic seed.
- Hosted latency/load testing: **not run**; the service is localhost-only.

No user feedback, adoption, revenue, industrial deployment, formal verification, or universal policy-safety claim is made.
