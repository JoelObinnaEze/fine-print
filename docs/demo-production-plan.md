# Demo video production plan

The video is a product demonstration, not a pitch deck. The face-camera take provides the human opening and closing; the middle is a clean screencast of the public recorded demo. This follows the official three-minute limit and Devpost guidance to lead with the elevator pitch and show the working product directly.

## Source files

| Asset | Owner | Requirement |
| --- | --- | --- |
| `fine-print-webcam-original.*` | Joel | One uninterrupted landscape take of `docs/demo-script.md` |
| `fine-print-screen-original.*` | Codex | 1920×1080, 30 fps capture of the sequence below |
| `fine-print-final.mp4` | Codex | H.264, 1080p, AAC audio, no more than 2:57 |
| `fine-print-captions.srt` | Codex | Corrected captions matching the final edit |
| `fine-print-thumbnail.png` | Codex | Product result, not a face-only thumbnail |

## Webcam handoff

1. Record horizontally at 1080p or better, eye-level, with the camera stable.
2. Use a quiet room and the clearest microphone available. Do not add music or noise reduction.
3. Frame from mid-chest upward with a simple background and light in front of you.
4. Leave two silent seconds before the first word and after the last word.
5. Read the teleprompter copy once without stopping. If you make a mistake, pause, repeat the sentence, and continue; the edit will remove it.
6. Send the original file, not a messaging-app recompression.

## Edit decision list

| Time | Picture | Screen action | Claim the picture must prove |
| --- | --- | --- | --- |
| 0:00–0:14 | Webcam | None | The problem and product are understandable immediately |
| 0:14–0:35 | Commerce · Step 1 | Start on the prefilled rule and its mapped summary | Rule, intended retained value, and honest-user promise are separate |
| 0:35–1:13 | Commerce · Step 2 | Click **What went wrong**; hold on `$20`, `$0`, and the three-event trace | Muse proposed four actions; simulator reduced and confirmed three |
| 1:13–1:56 | Commerce · Step 3 | Click **Best repair**; hold on the rejected immediate reversal, case count, and updated recommendation | `$10` unrecovered in the recheck; applicable cases re-rank the repairs; recommended repair has `$0` observed exposure, preserves `$20`, and waits 30 days |
| 1:56–2:10 | Commerce · Step 3 | Open **Compare all repairs**, then close it | Competing repairs and tradeoffs exist without crowding the main story |
| 2:10–2:38 | Bottle Return · Step 2 | Switch domains and click **What went wrong**; hold on `30 points / 0 recycled`, then click **Replay from start** at 2× | Same method transfers to a visibly different system |
| 2:38–2:47 | Bottle Return · Step 3 | Click **Best repair** | Processing-backed recommendation is obvious |
| 2:47–end | Webcam | None | Human close and memorable one-question framing |

## Recording setup

- Use the public static judge build so the recording has no network dependency or paid request.
- Browser viewport: 1920×1080 or 1600×900 at 100% zoom.
- Hide bookmarks, downloads, extensions, notifications, and unrelated tabs.
- Keep the cursor visible but still while narration lands on a result.
- Use hard cuts or short dissolves only. Do not add stock footage, animated logos, or decorative transitions.
- Use quiet captions in the lower safe area. Highlight only `$20 reward`, `$0 value`, and `30 points / 0 recycled`.
- Keep all on-screen evidence large enough to read on a laptop without pausing.

## Reliability plan

- Primary path: recorded Muse evidence bundled into the public build.
- If a click is mistimed, cut to the same scene from a second screencast take; never show loading.
- The 3D scene opens on its final state so the result is never hidden; the replay is supporting motion, not required evidence.
- Do not run a fresh paid request in the submitted video. The exact live run IDs and costs remain available under run details and in the repository.

## Final review gate

- Runtime is below 3:00 after the host platform processes the file.
- Opening explains the problem within 10 seconds.
- Muse is visibly central, but the host—not the model—decides results.
- Every spoken number matches the UI and checked-in artifacts.
- The 12-case evaluation is named once, not enumerated; complete misses and errors stay in the report rather than crowding the demo.
- Captions, audio, and app text are legible on a 13-inch laptop.
- The video link works in an incognito window without sign-in.
