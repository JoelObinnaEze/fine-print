# Three-minute demo script

Use **Load recorded starting-policy run** for a reliable offline demo. Use a **Fresh-attack** button only when the API is connected and event credits are available; never describe recorded replay, regression cases, or a bounded search as the same kind of evidence.

## 0:00–0:20 — The problem

Open on **30 points paid. 0 items recycled.** Say: “The policy did exactly what it said and failed what its author meant.” Then point to the separate **Paid points** and **Actually recycled** counters.

## 0:20–0:45 — Compile and inspect the rule

Show the plain-English policy compiler and its review fields: reward trigger, eligible objects, repeat limit, and successful-processing requirement. Expand **Inspect structured policy** and highlight `trigger: deposit`, `eligibleOnly: false`, and `repetition: every_event`. Say: “Meta proposes; a person reviews; the host validates.”

## 0:45–1:15 — Watch the exploit

Press **Jump to next payout**, then play or step through ticks 7, 9, and 11. Pause at tick 11: 30 paid, zero recycled. Click the three payout events and say: “The host generated each receipt from engine events. The agent never writes the ledger.”

## 1:15–1:45 — Patch, regress, and reattack

Select **Test once-per-item patch**. Show 3/3 honest workflows preserved but only 1/3 known failures blocked: duplicate reward is gone, while ineligible and pre-completion payouts remain. Point to **Fresh-attack once-per-item patch** and say: “A separate live Muse search verified exactly that second-order failure: an ineligible item earned 10 points with zero useful recycling.”

## 1:45–2:10 — Stronger patch

Select **Test eligible-processing patch**. Show 3/3 honest workflows preserved and 3/3 known failures blocked. Point to **Fresh-attack eligible-processing patch** and say: “A separate 12-request search found no exploit within budget. That is a bounded search result, not a universal safety claim.”

## 2:10–2:35 — Recorded Meta evidence

Press **Load recorded starting-policy run**. Show `Recorded model replay`, `muse-spark-1.3`, 10 actual requests, $0.070258 cost, and the exact 13-action timeline. Say: “Meta proposed actions; the host replay verified 30 excess points and zero recycled items, preserving two invalid actions rather than correcting them.”

## 2:35–2:55 — Technical depth

Open **Policy Lab** and show the exact structured diff, provenance, limits, cost, and receipt audit. Then show the architecture line in the README: untrusted Meta proposal → strict schemas → host limits → deterministic engine → SQLite evidence and hash-verified export.

## 2:55–3:00 — Close

“Fine Print turns vague incentives into inspectable failures, patches, and reproducible evidence—without pretending a bounded search proves safety.”
