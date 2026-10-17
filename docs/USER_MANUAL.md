# Web Security Hub User Manual

[日本語版](ja/USER_MANUAL.md)

> Start with the [illustrated hands-on course](training/README.md). See [feature coverage](training/COVERAGE.md) for core and advanced workflows.

## 1. Purpose

Web Security Hub is a local tool that uses one target site, authentication configuration, and test scenario for both form regression tests and web application security assessment. Test-value generation and scanning are rule-based. Claude Code SAST review and natural-language assertions are optional features requiring explicit enablement.

Main uses:

- Crawl HTML forms and generate normal, boundary, and invalid test cases.
- Replay generated Playwright tests and compare visual output.
- Send pages and traffic reached by Playwright to ZAP for assessment with its existing rules.
- Perform static analysis of local source code.

## 2. Start

```sh
npm install
npx playwright install chromium
npm start
```

Open `http://localhost:4173`. If `EADDRINUSE` appears, use that URL because a server is already running, or stop the existing server before restarting.

Start ZAP separately when using the integration:

```sh
docker compose -f docker-compose.zap.yml up -d
```

The first run can take time while the container image downloads. Stop it when finished:

```sh
docker compose -f docker-compose.zap.yml down
```

## 3. Site management

1. On the **Site Management** tab, enter a site ID, display name, and start URL.
2. Set maximum crawl depth, maximum pages, and maximum cases per form.
3. For login, configure the URL, input selectors, submit selector, and credentials.
4. Save the site.

Credentials are stored in `sites/<siteId>/.env` and are never displayed again. Use a dedicated test account.

### Saved scenarios

Use **Saved Scenario** to store a JSON object containing `steps`. Basic actions are `goto`, `click`, `fill`, `check`, `select`, and `wait`; a scenario can contain up to 50 steps. See the [README](../README.md) and [coverage table](training/COVERAGE.md) for navigation, file operations, branches, loops and other extensions. Do not put credentials in this JSON. Login selectors are saved in Site Management and credentials remain in `.env`.

The saved scenario is used by test-case generation and is embedded in generated Playwright replay specs. In **Dynamic Security Scan**, select **Use the saved scenario for the selected site** to run the same authenticated flow without exposing credentials to the browser UI.

### Record a scenario with Playwright

1. Save and select the site, including any login selectors and test-account credentials.
2. In **Playwright Interaction Recording**, confirm that you are authorized, then select **Open recording browser**.
3. A visible Chromium window opens. Follow the permitted application path; the configured login runs first using the server-side `.env` credentials.
4. Select **Stop recording and copy to scenario**. Review the generated JSON and select **Save** to persist it.

Clicks, selection changes, checks, and direct navigation are recorded. Passwords and fields whose selector indicates credentials, tokens, or secrets are never recorded. Non-password values are recorded only when the opt-in checkbox is selected. Review selectors and remove any personal or sensitive values before saving. The resulting scenario is then available to test generation, replay, and the authenticated DAST flow.

## 4. Generate test cases

On **Test Case Generation**, select **Run Pipeline**.

The pipeline crawls the site, extracts forms, creates candidate values from HTML constraints, builds pairwise combinations, and generates a Playwright spec. Artifacts are stored at `.golden-master/session-<timestamp>/` for each site.

| Artifact | Contents |
|---|---|
| `forms.json` | Discovered forms, fields, and constraints |
| `test-cases.json` | Generated cases |
| `test-cases.yaml` | Editable case definition |
| `generated.spec.ts` | Spec for Playwright replay |
| `report.html` / `report.md` | Test-generation and execution report |

Values are rule-based. `required`, `min`, `max`, `maxlength`, `pattern`, field type, labels, and related HTML attributes produce normal, boundary, and invalid values.

## 5. Edit and replay test cases

1. On **Replay**, select a session.
2. Select **Load** to open YAML cases in the table.
3. Update values as needed and select **Save and Regenerate**.
4. First select **Record Baseline**; on subsequent runs select **Replay and Compare**.

Enter a comparison URL to run the same spec against a different environment.

## 6. Combine ZAP and test cases

1. Start ZAP and verify connectivity with **Check ZAP Connection** on **Dynamic Security Scan**.
2. On **Replay**, enable **Send all traffic from this test-case run to ZAP**.
3. Run the regression test.
4. ZAP alerts are written to the session's `zap-alerts.json`. When correlation is available, `testCaseIds` contains the relevant test-case ID.

Use **Also run ZAP Active Scan** only on explicitly authorized staging. It cannot run without the authorization checkbox.

To use an existing session with ZAP integration, first save it from **Edit Test Cases** to regenerate the spec.

## 7. Dynamic security assessment

Set a start URL, crawl scope, and, where needed, authentication and scenario JSON. Passive assessment checks HTTPS, security headers, cookie attributes, mixed content, and form construction. Enabling ZAP also makes ZAP Passive and Active Scan Rules available.

Example scenario JSON:

```json
{
  "login": {
    "url": "https://staging.example.test/login",
    "usernameSelector": "#email",
    "username": "tester@example.test",
    "passwordSelector": "#password",
    "password": "test-password",
    "submitSelector": "button[type=submit]"
  },
  "steps": [
    { "action": "click", "selector": "a[href='/settings']" },
    { "action": "fill", "selector": "#search", "value": "sample" }
  ]
}
```

Basic actions are `goto`, `click`, `fill`, `check`, `select`, and `wait`. See the README for extended actions. Credentials and scenario content are neither persisted nor included in assessment results.

## 8. Static analysis

On **Static Analysis**, enter the absolute path to local source code. `node_modules`, `.git`, `dist`, `build`, and `coverage` are excluded. Current rules detect dynamic code execution, command-execution APIs, SQL string concatenation, possible secrets, and disabled TLS verification.

Each run is saved locally under `artifacts/static-scans/<run-id>/`. The interface provides links to JSON, HTML, Markdown, and SARIF reports. A report records the source directory, execution time, file count, severity summary, and findings; it can therefore be retained as scan evidence or imported by SARIF-compatible tools. The `artifacts/` directory is ignored by Git.

### Optional AI review with Claude Code

After a static-analysis run, the **AI Review with Claude Code** section can request a local Claude Code review. It is optional and requires Claude Code to be installed and logged in with the user's own subscription. Before every review, explicitly authorize sending the displayed SAST result.

The adapter sends a limited review package containing the SAST summary and finding metadata (rule ID, severity, location, evidence, and remediation). It does not send source text, credentials, or API keys, and it starts Claude Code from a temporary directory rather than the project directory. The response is advisory only; verify every conclusion before treating it as a vulnerability or remediation decision.

If `ANTHROPIC_API_KEY` is present, the adapter removes it from Claude Code's execution environment so that a local Claude subscription login is preferred over API billing.

## 9. Safe operation

- Assess only systems you own or have written authorization to test.
- Run active checks against staging containing only test data, not production.
- Exclude irreversible paths such as deletion, cancellation, account closure, and payment.
- Give authentication accounts least privilege and no personal data.
- Have a person validate findings before creating tickets or deciding on remediation.
