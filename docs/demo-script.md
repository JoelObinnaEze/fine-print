# Three-minute demo script

Use **Load verified Muse run** for a reliable demo. Use the live button only when the API is connected and event credits are available; never describe a recorded trace as a fresh call.

## 0:00–0:20 — The problem

Show the depot and say: “This rule pays 10 points whenever an item is deposited. The author wants recycling, but the executable rule only observes deposits.” Point to the separate **Paid points** and **Actually recycled** counters.

## 0:20–0:45 — Compile and inspect the rule

Show the plain-English policy compiler, then expand **Inspect structured policy**. Highlight `trigger: deposit`, `eligibleOnly: false`, and `repetition: every_event`. Say: “Meta may propose this candidate, but it cannot activate it or write engine state. A person reviews the bounded structure first.”

## 0:45–1:15 — Watch the exploit

Press **Jump to next payout**, then play or step through ticks 7, 9, and 11. Pause at tick 11: 30 paid, zero recycled. Click the three payout events and say: “The host generated each receipt from engine events. The agent never writes the ledger.”

## 1:15–1:40 — Patch and replay

Select **Test once-per-item patch**. Show that repeat payouts stop while premature deposit payment remains. Then select **Test eligible-processing patch** and show 30 versus 0 on the same 11-action prefix. Say: “This exploit stopped paying; that is not the same claim as policy safety.”

## 1:40–2:05 — Regression gauntlet

Scroll to **Policy gauntlet**. Show the original 50/100 score, 100% honest-work coverage, and both observed adversarial leaks. Activate the eligible-processing patch and show its 100/100 counterfactual with two of two attacks blocked. Say: “This score is scoped to disclosed traces, not a universal safety claim.”

## 2:05–2:35 — Live Meta evidence

Press **Load verified Muse run**. Show `Live model`, `muse-spark-1.3`, 10 actual requests, $0.070258 cost, and the exact 13-action timeline. Say: “Meta proposed actions; the host replay verified 30 excess points and zero recycled items, preserving two invalid actions rather than correcting them.”

## 2:35–2:55 — Technical depth

Open **Policy Lab** and show the exact structured diff, provenance, limits, cost, and receipt audit. Then show the architecture line in the README: untrusted Meta proposal → strict schemas → host limits → deterministic engine → SQLite evidence and hash-verified export.

## 2:55–3:00 — Close

“Fine Print turns vague incentives into inspectable failures, patches, and reproducible evidence—without pretending a bounded search proves safety.”
