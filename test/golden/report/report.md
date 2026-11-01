# Precision Test Platform — Test Report

session: `session-fixed` · 2 forms · 4 cases total · 2 PASS · 2026-01-02 03:04:05

### /signup?ref=a|b

4 cases · 2 PASS

| Case ID | Name | Kind | Result | Inputs | Error |
|---|---|---|---|---|---|
| case-001 | 正常系: 基本入力 | normal | PASS | email=a@example.test, agree=on, plan=off |  |
| case-002 | 異常系: empty & "quoted" | abnormal | FAIL | email=(empty), note=a\|b\\c line | boom \| <pipe> second line |
| case-003 | Boundary length | boundary | PASS | name=xxxxx |  |
| case-004 | abnormal skipped | abnormal | SKIP |  |  |

### not a url

0 cases · 0 PASS

| Case ID | Name | Kind | Result | Inputs | Error |
|---|---|---|---|---|---|
