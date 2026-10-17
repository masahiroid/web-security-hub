# Instructor guide

[日本語](INSTRUCTOR.ja.md) · [Learner guide](README.md)

## Preparation

Verify Node.js 22+, npm and Chromium. Each learner needs an independent local sample server: mode changes affect all browsers connected to the same server.

Before delivery, run `npm test`, `npm run training:verify` and `npm run training:capture`. Stop manually started Hub/sample servers first: the latter commands start their own servers. Capture creates a new generation session for each training site and edits only that new session. It preserves previous sessions and does not automatically terminate processes occupying its ports.

Learners start with `training:setup` and the two server terminals. If they register a new practice site, keep that site selected throughout. English uses `/en/` URLs and `training-en`; Japanese uses `/ja/` and `training-ja`.

## Suggested delivery

| Approximate time | Steps | Completion checkpoint |
|---|---|---|
| 0–10 minutes | T01–T02 | Explain the two ports; submit a demo application |
| 10–25 minutes | T03–T04 | Verify credentials and the saved scenario |
| 25–40 minutes | T05–T06 | Generate cases; keep one case with five participants |
| 40–60 minutes | T07–T08 | Unchanged PASS → changed differences → fixed PASS |
| 60–80 minutes | T09–T10 | Explain DAST changes and before/after SAST findings |
| 80–90 minutes | T11 | Share observations and clean up |

These are planning estimates, excluding initial downloads, hardware variation and recovery time.

## Assessment criteria

- T04: Reach the application form without storing a password in scenario JSON.
- T05: Generate at least one form and open its report. Understand that generation's OK does not establish business correctness.
- T06: Keep the first row; use `Demo Learner`, `learner@example.test`, and `5`. Optional columns may be absent.
- T07: Baseline recording and unchanged comparison both pass.
- T08: Changed mode reports differences; fixed mode passes. Do not update the baseline in between.
- T09: Only changed mode adds `DAST-HEADER-CONTENT-SECURITY-POLICY` and `DAST-HEADER-X-CONTENT-TYPE-OPTIONS` for the single application page.
- T10: Before yields `SAST-DANGEROUS-EVAL` and `SAST-SQL-CONCAT`; after yields zero findings.

Discuss why local HTTP findings remain, how scenario actions differ from passive analysis, and why visual comparison cannot establish every business requirement. Use the same OS, browser and fonts for baseline and comparison.

## Recovery

If recording includes submission, restore the T04 JSON. If a learner accidentally records the changed version as the baseline, restore baseline mode, record again, then repeat the unchanged comparison.

Use `npm run training:setup -- --reset` for configuration and `npm run training:mode -- reset` for sample state. Configuration reset preserves previous sessions. Run the pipeline again and select its new session when restarting an exercise.

## Feedback to collect

Record application version, OS/browser, locale, session ID, step ID, expected behavior, actual behavior and a screenshot if useful. Exclude real credentials and personal data. Turn these reports into sample reproductions, fixes, regression tests and synchronized updates to both guides.
