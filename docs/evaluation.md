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

The per-request ledger rounds cost upward to microdollars, so this trace consumed $0.070261 against the cap. At this original checkpoint, the ledger conservatively counted $0.149575 and left at least $9.850425 of the authorized $10 app cap; the current total appears below.

## Frozen discovery benchmark

The suite was frozen under hash `ba56f2d7b5a25acb4cf0100fd2235252f70f9b6b71d9653f67a15aa7f7e9bbf1` before the eight live attempts below. It contains two deliberately flawed policies and their blocked counterparts. Every attempt is reported; no best run was selected.

The simple baseline is a deterministic beam search with seeds 17, 29, and 43, a 30,000-state budget, 40-action depth, and beam width 256. Muse receives at most 12 requests, four trials, 120 ticks per trial, and two minutes.

| Frozen policy | Expected | Simple search | Muse attempt 1 | Muse attempt 2 | Honest reward |
| --- | --- | ---: | --- | --- | ---: |
| Eligible deposit before processing | flawed | 3 / 3 found | verified · 9 requests · 17 actions | verified · 8 requests · 18 actions | 60 / 60 |
| Eligible processing receipt | blocked | 0 / 3 found | completed, no exploit · 12 requests · 19 actions | completed, no exploit · 12 requests · 14 actions | 60 / 60 |
| Hopper-count batch bonus | flawed | 3 / 3 found | completed, no exploit · 12 requests · 31 actions | verified · 12 requests · 76 actions | 70 / 70 |
| Processed-receipt batch bonus | blocked | 0 / 3 found | completed, no exploit · 12 requests · 12 actions | completed, no exploit · 12 requests · 13 actions | 70 / 70 |

Muse found the simple premature-payment flaw reliably and the interacting batch flaw in one of two attempts. The baseline found both more reliably on this small deterministic world. That comparison is intentionally retained: Muse's value here is an inspectable natural-language hypothesis/tool workflow, not a claim that it beats search on a tiny state space. Independent verification rejected no submitted candidates in these eight runs.

The eight live benchmark attempts cost $0.700546 in raw token usage. After all project activity, the durable ledger records $1.443446 settled, $0.004075 ambiguous, and $8.552479 still available from the authorized $10 cap.

## Not run

- Volunteer usability study: **not run**; participants = 0.
- Public deployment/incognito judge access: **not run**.
- Cross-seed scenario evaluation: **not run**; Bottle Return currently has one named deterministic seed.
- Hosted latency/load testing: **not run**; the service is localhost-only.

No user feedback, adoption, revenue, industrial deployment, formal verification, or universal policy-safety claim is made.
