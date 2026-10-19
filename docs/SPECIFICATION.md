# Web Security Hub Functional Specification

[日本語版](ja/SPECIFICATION.md)

## 1. Features

| ID | Feature | Input | Output |
|---|---|---|---|
| F-01 | Site management | Site configuration, credentials | `site.config.json`, `.env` |
| F-02 | Test generation | Site ID | Forms, cases, spec, reports |
| F-03 | Case editing | Session, edited YAML values | Updated YAML, regenerated spec |
| F-04 | Regression replay | Session, comparison URL | Playwright result, comparison report |
| F-05 | DAST | URL, scope, scenario, authorization confirmation | DAST findings |
| F-06 | ZAP integration | ZAP API/proxy, Active Scan authorization | `zap-alerts.json` |
| F-07 | SAST | Local source directory | SAST findings; JSON, HTML, Markdown, and SARIF reports |
| F-08 | Scenario recorder | Saved site, authorization confirmation | Reviewed Playwright-compatible scenario steps |

## 2. API specification

| Method | Path | Description |
|---|---|---|
| GET / PUT | `/api/sites`, `/api/sites/:id` | List sites or update configuration |
| GET | `/api/sites/:id/pipeline/run` | Test-generation SSE stream |
| GET | `/api/sites/:id/sessions/:sessionId/replay` | Replay SSE stream |
| GET / PUT | `/api/sites/:id/sessions/:sessionId/test-cases` | Edit YAML cases |
| POST | `/api/security/dynamic-scan` | Playwright DAST |
| POST | `/api/security/zap-status` | Check ZAP reachability |
| POST | `/api/security/static-scan` | SAST |
| GET / POST | `/api/scenario-recorder/status`, `/api/scenario-recorder/start`, `/api/scenario-recorder/stop` | Local visible Playwright recording |

### DAST request

`POST /api/security/dynamic-scan` requires `targetUrl` and `authorizationConfirmed: true`. It can also receive `scenario`, `zap`, `allowActiveScan`, and crawl limits.

### ZAP parameters for replay

`zap=1` enables the Playwright proxy. `activeZap=1` requests ZAP Active Scan and also requires `authorized=1`.

### Scenario recorder

`POST /api/scenario-recorder/start` requires a saved `siteId` and `authorized: true`. It launches one local headed Chromium session, executes configured login with server-side credentials, and records portable scenario actions. Only one recorder session can be active. Stopping returns steps to the browser UI; it does not persist them until the user saves the site configuration.

## 3. Non-functional requirements

- Requires Node.js 22.19.0 or later.
- The UI is served by a local Express server.
- Long-running generation and replay report progress with SSE.
- Crawl limits are at most 100 pages and depth 10.
- Source analysis is limited to 3,000 files and 1 MiB per file.

## 4. Acceptance criteria

- A saved site can produce forms, cases, and a Playwright spec through the pipeline.
- Edited YAML can regenerate the spec.
- The same session can record a baseline and run a comparison replay.
- DAST cannot start without authorization confirmation.
- A ZAP-integrated run saves `zap-alerts.json` and can include applicable case IDs.
- Static analysis saves JSON, HTML, Markdown, and SARIF reports only under `artifacts/static-scans/` and does not write into the target source directory.
- Scenario recording requires explicit authorization, never records passwords, and requires a separate opt-in for non-password input values.
