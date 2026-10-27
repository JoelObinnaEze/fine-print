# Three-minute demo script

Use the persisted replay for a reliable demo. Do not spend credits or describe a recorded trace as a fresh live call.

## 0:00–0:20 — The problem

Show the depot and say: “This rule pays 10 points whenever an item is deposited. The author wants recycling, but the executable rule only observes deposits.” Point to the separate **Paid points** and **Actually recycled** counters.

## 0:20–0:45 — Inspect the rule

Expand **Inspect structured policy**. Highlight `trigger: deposit`, `eligibleOnly: false`, and `repetition: every_event`. Say: “Meta translated the original natural-language rule through a strict server-side schema; this displayed replay is explicitly labelled scripted fixture.”

## 0:45–1:15 — Watch the exploit

Press **Jump to next payout**, then play or step through ticks 7, 9, and 11. Pause at tick 11: 30 paid, zero recycled. Click the three payout events and say: “The host generated each receipt from engine events. The agent never writes the ledger.”

## 1:15–1:40 — Patch and replay

Select **Test once-per-item patch**. Show that repeat payouts stop while premature deposit payment remains. Then select **Test eligible-processing patch** and show 30 versus 0 on the same 11-action prefix. Say: “This exploit stopped paying; that is not the same claim as policy safety.”

## 1:40–2:05 — Policy Lab

Scroll to **Policy Lab**. Show the exact structured field diff, separate receipt counts, scripted provenance, zero inference requests, 120-tick limit, and 12 submitted actions.

## 2:05–2:35 — Live Meta evidence

Open `artifacts/attacker-live-v2.json`. Show `provenance: live_model`, `modelId: muse-spark-1.3`, the 12-request/four-trial limits, 10 actual requests, $0.070258 cost, and integrity/replay hashes. Say: “In the authorized live search, Meta submitted 13 actions. The host replay verified 30 excess points and zero recycled items, preserving two invalid actions rather than correcting them.”

## 2:35–2:55 — Technical depth

Show the architecture line in the README: untrusted Meta proposal → strict schemas → host limits → deterministic engine → SQLite evidence and hash-verified export. Mention timeout reservations, duplicate/late tool rejection, cancellation, and replay from the immutable root.

## 2:55–3:00 — Close

“Fine Print turns vague incentives into inspectable failures, patches, and reproducible evidence—without pretending a bounded search proves safety.”
