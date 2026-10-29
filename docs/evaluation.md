# Evaluation report

Status: completed locally on October 27, 2026, with commerce value-accounting corrected on October 29. The Bottle Return machine-readable source is [`artifacts/evaluation.json`](../artifacts/evaluation.json).

## Commerce incentive investigation

The commerce workbench accepts the payout policy, intended retained-revenue outcome, and protected restrictions as separate inputs. Model prose remains labelled as an unverified hypothesis; only deterministic host replay can emit a verified verdict.

| Attempt | Muse proposal | Host result | Honest customer result | Model cost |
| --- | ---: | --- | --- | ---: |
| Referral/refund policy | 4 actions → 3 required | `$20` unintended spendable credit, `$0` retained revenue | `$20` reward on `$20` retained revenue, 0-day delay | `$0.013197` |
| Reverse-credit recheck | 5 actions | `$10` already spent and unrecovered, `$0` retained revenue | `$20` reward on `$20` retained revenue, 0-day delay | `$0.010456` |
| Pay-after-window repair | Same 5-action replay | `$0` reward value exposed | `$20` reward on `$20` retained revenue, 30-day delay | No new model call |

The original durable investigation ID is `243986a6-b49a-4b16-9930-bee96912b6e4`; the repair recheck is `c7191265-4e4c-41ca-8940-52b724211a8d`. The original live artifacts remain unchanged. [`commerce-repair-reverified.json`](../artifacts/commerce-repair-reverified.json) binds the source artifact hash to the corrected host verdict: reward marked reversed is not treated as recovered when an account still carries reversal debt.

Population traces are deliberately small and deterministic: ordinary customers keep a wanted purchase, bargain hunters spend earned promotional credit on another kept purchase, and two coordinated accounts purchase then refund. Their results describe these disclosed traces, not real-world fraud prevalence. A repair that rejects a later attack action is scored on every accepted prefix, so leakage before rejection is still counted.

Confirmed commerce cases are now append-only and bound to an evidence-set ID, exact source-policy hash, tested-repair ID, and tested-policy hash. Candidate repairs are replayed against every applicable stored trace. Their displayed exposure is the highest value observed across those cases; a later bounded miss, invalid sequence, or provider failure cannot erase an earlier confirmed failure. The UI describes this as observed exposure, not a guaranteed maximum.

The discovery comparison does not claim Muse outperforms ordinary search. Muse found the premature-deposit case in 2/2 attempts and the interacting batch case in 1/2; the deterministic beam-search baseline found both in 3/3. Muse's demonstrated role is interpreting policy text, proposing inspectable hypotheses, and generating repair options, while host replay supplies the evidence.

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
| Eligible processing receipt | blocked | 0 / 3 found | completed, no failure found · 12 requests · 19 actions | completed, no failure found · 12 requests · 14 actions | 60 / 60 |
| Hopper-count batch bonus | flawed | 3 / 3 found | completed, no failure found · 12 requests · 31 actions | verified · 12 requests · 76 actions | 70 / 70 |
| Processed-receipt batch bonus | blocked | 0 / 3 found | completed, no failure found · 12 requests · 12 actions | completed, no failure found · 12 requests · 13 actions | 70 / 70 |

Muse found the simple premature-payment flaw reliably and the interacting batch flaw in one of two attempts. The baseline found both more reliably on this small deterministic world. That comparison is intentionally retained: Muse's value here is an inspectable natural-language hypothesis/tool workflow, not a claim that it beats search on a tiny state space. Independent verification rejected no submitted candidates in these eight runs.

The eight original live Bottle Return benchmark attempts cost $0.700546 in raw token usage. At that checkpoint, before the v3 evaluation runs below, the durable ledger recorded $1.694354 settled and $0.004075 ambiguous.

## Versioned 12-case evaluation

`fine-print-eval-v3` is a designed benchmark frozen under SHA-256 `d9a1360ff04f78964244934adc17dda8556a9904a40159b233b5fb230c04dc3a`. It contains six failure/control pairs using only supported Bottle Return and commerce mechanisms. Every case records the exact initial state, executable policy, stated intended outcome, protected honest behavior, deterministic reference trace, expected classification, and replay result in [`artifacts/evaluation.json`](../artifacts/evaluation.json).

All 12 reference replays matched their frozen classification and preserved the stated honest behavior. Reference traces and labels were excluded from model inputs. These are designed cases, not observed customer incidents.

| Mechanism | Failure case: model | Control: model | Deterministic baseline | Notes |
| --- | --- | --- | --- | --- |
| Repeated deposits | 2 / 3 confirmed | 0 / 3 confirmed | 3 / 3; control 0 / 3 | One bounded model miss retained |
| Ineligible material | 3 / 3 confirmed | 0 / 3 confirmed | 3 / 3; control 0 / 3 | Same processing-backed control |
| Transient batch bonus | 1 / 3 confirmed | 0 / 3 confirmed | 3 / 3; control 0 / 3 | Two bounded model misses retained |
| Credit retained after refund | 2 / 2 scored confirmed | 0 / 3 confirmed | Not implemented for commerce | Third failure-case attempt ended in a response-schema error; control had two misses and one invalid sequence |
| Credit spent before reversal | 0 / 3 confirmed | 0 / 3 confirmed | Not implemented for commerce | Failure case had two misses and one invalid sequence; this is a known discovery miss, not evidence the rule is robust |
| Promotional-credit qualification | Not run | Not run | Not implemented for commerce | Offline case starts with a disclosed `$20` promotional balance; the live endpoint currently fixes starting credit at `$0` |

Twelve earlier commerce attempts are also retained under `supersededCommerceAttempts`. Their shorter wording allowed material mapping drift, so none was scored against the frozen executable policies. The corrected v3 wording states reward, threshold, qualification basis, issuance, refund handling, return window, and promotional-credit treatment explicitly.

Interpretation and discovery are reported separately. The dedicated interpretation matrix freezes expected fields plus clarification and unsupported cases, but its live runs remain **not run**; no fixture output is counted as live evidence. Within v3 commerce discovery, only attempts whose executable mapping matched every material frozen field were scored. Bottle Return uses the existing deterministic beam search at three seeds, 30,000 expanded states, 40-action depth, and width 256. Commerce currently has no equivalent deterministic search baseline, so the report says `not_supported_for_commerce` rather than implying equal compute.

The live suite evidence represented `$1.791247` of model calls including earlier persisted Bottle Return attempts. The superseded commerce wording attempts cost `$0.135545`. The current durable ledger records `$2.716904` settled, `$0.004075` ambiguous, no active reservation, and `$6.279021` available under the configured usable app budget.

Automated acceptance coverage links each behavior to its reproducible test: supported mapping, deterministic verification, trace minimization, failure of a superficially plausible repair, preservation under the stronger repair, recommendation refresh, unsupported-condition disclosure, and bounded-miss language. These checks establish software behavior. Policy-owner usefulness, customer demand, adoption, and market value remain unvalidated.

## Not run

- Volunteer usability study: **not run**; participants = 0.
- Public deployment/incognito judge access: **not run**.
- Cross-seed scenario evaluation: **not run**; Bottle Return currently has one named deterministic seed.
- Hosted latency/load testing: **not run**; the service is localhost-only.
- Dedicated live interpretation matrix: **not run**; expected fields and dispositions are frozen, but no fixture is reported as live output.
- Promotional-credit live pair: **not run**; the required disclosed nonzero starting balance is not accepted by the live endpoint.

No user feedback, adoption, revenue, industrial deployment, formal verification, or universal policy-safety claim is made.
