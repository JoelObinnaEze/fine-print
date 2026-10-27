# Submission and judge-access checklist

Updated October 27, 2026. Checked items are locally verified; unchecked items still require work or an explicit user action.

## Product evidence

- [x] Offline game explains reward versus useful outcome.
- [x] Strict natural-language policy translation completed with Meta.
- [x] Bounded live Meta attacker trace independently replayed and persisted.
- [x] Immutable patch comparison and Policy Lab are visible in Opera GX.
- [x] Portable live replay and machine-readable evaluation artifacts verify locally.
- [x] Actual provider model, limits, tokens, and cost are recorded.
- [ ] Volunteer usability study — **not run**.
- [ ] Cross-seed evaluation — **not run**; only Bottle Return seed v1 exists.

## Repository and operations

- [x] `npm ci`, full tests, strict typecheck, production build, and high-severity audit pass locally.
- [x] `.env`, database files, build output, and credentials are ignored.
- [x] README includes setup, trust boundaries, attribution, limitations, and commands.
- [x] License decision recorded: no license selected; keep the repository unlicensed until the user chooses otherwise.
- [ ] Publish the repository — **not performed**.
- [ ] Deploy the application — **not performed**.
- [ ] Run a clean-clone rehearsal on the final published revision.
- [ ] Test the public URL in an incognito browser — **not run**.

## Demo and submission

- [x] Three-minute recording script is ready.
- [ ] Record and trim the demo video — **not performed**.
- [ ] Verify video captions/audio and public access.
- [ ] Confirm final team/Indie-track details in the participant portal.
- [x] Current local claims reviewed against `artifacts/evaluation.json`; review again after any later product change.
- [ ] Submit through the hackathon portal — **not performed; user action required**.
- [ ] Accept any final legal terms or attestations — **not performed; user action required**.

## Judge access

- [ ] Public repository URL:
- [ ] Live product URL:
- [ ] Demo video URL:
- [ ] Test credentials, if needed (prefer none):
- [x] No API key is shipped to the browser or tracked repository.
- [x] Paid endpoints are budget-capped and bound to localhost; no anonymous public service is running.
