# Submission and judge-access checklist

Updated October 29, 2026. Checked items are verified; unchecked items still require human input or the final publication run.

## Product evidence

- [x] Offline game explains reward versus useful outcome.
- [x] Strict natural-language policy translation completed with Meta.
- [x] Bounded live Meta attacker trace independently replayed and persisted.
- [x] Immutable patch comparison and Policy Lab are visible in Opera GX.
- [x] Portable live replay and machine-readable evaluation artifacts verify locally.
- [x] Actual provider model, limits, tokens, and cost are recorded.
- [x] Cross-seed evaluation reports every frozen run, including unsuccessful attempts.
- [ ] Volunteer usability study — **not run**.

## Repository and operations

- [x] `npm ci`, full tests, strict typecheck, production build, and high-severity audit pass locally.
- [x] `.env`, database files, build output, and credentials are ignored.
- [x] README includes setup, trust boundaries, attribution, limitations, and commands.
- [x] License decision recorded: no license selected; keep the repository unlicensed until the user chooses otherwise.
- [ ] Publish the public repository and static judge build.
- [ ] Run a clean-clone rehearsal on the final published revision.
- [ ] Test the public URL in a clean browser session.

## Demo and submission

- [x] Three-minute teleprompter script, shot list, edit decision list, and fallback path are ready.
- [x] Paste-ready submission copy and a one-minute judge guide are ready.
- [ ] Record and trim the demo video — **not performed**.
- [ ] Verify video captions/audio and public access.
- [ ] Confirm final team/Indie-track details in the participant portal.
- [x] Every numeric demo claim is backed by the checked-in live evidence.
- [ ] Submit through the hackathon portal — **not performed; user action required**.
- [ ] Accept any final legal terms or attestations — **not performed; user action required**.

## Judge access

- [ ] Public repository URL: `https://github.com/JoelObinnaEze/fine-print`
- [ ] Live product URL: `https://joelobinnaeze.github.io/fine-print/`
- [ ] Demo video URL:
- [ ] Test credentials, if needed (prefer none):
- [x] No API key is shipped to the browser or tracked repository.
- [x] Paid endpoints are budget-capped and bound to localhost; no anonymous public service is running.
