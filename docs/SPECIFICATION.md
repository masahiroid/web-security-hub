# Web Security Hub Specification

[日本語版](ja/SPECIFICATION.md) · [Architecture](ARCHITECTURE.md) · [Detailed design](DETAILED_DESIGN.md) · [Screen design](SCREEN_DESIGN.md)

## 1. Purpose and scope

Web Security Hub is a web-security assessment, form-regression and verification tool that runs on the user's own machine. From one window it lets you:

- Discover forms by crawling a web application, generate test cases from normal, boundary and abnormal inputs, and replay them to compare before and after a change.
- Run dynamic assessment (passive checks, optionally with ZAP) against an authorized target, and static analysis against local source code.
- Run control-first verification against a built-in sample or an authorized local target, and keep results and evidence private.
- Create and export OpenVEX documents based on verification results.

### Out of scope

- Assessing targets the user does not own or has no explicit authorization to test.
- Authentication-bypass or denial-of-service testing, including bulk sending that amounts to denial of service.
- Cloud features that automatically transmit results elsewhere. Results stay on the machine.
- Guaranteeing safety. A run with no findings means only that nothing was found within the trials performed.

## 2. Terms

| Term | Meaning |
|---|---|
| Site | The configuration unit for a target: identifier, start URL, crawl limits, login settings and so on |
| Session | The output of one test-case generation run: forms, cases, test code and reports |
| Baseline | The screen state recorded as the reference for replay |
| Normal control | A trial that confirms a legitimate, permitted input succeeds before any candidate is sent |
| Candidate | An input built for verification, including inputs that should be rejected |
| Evidence | Observations tied to a trial: server-side observations, responses, source identifiers |
| Independent reproduction | Confirming a found violation by re-executing it in a separate session |
| Statement | One entry of an OpenVEX document (a product, vulnerability and status) |

## 3. Functions

| ID | Function | Main input | Main output |
|---|---|---|---|
| F-01 | Site management | Site settings, credentials | Site configuration file, secrets file |
| F-02 | Test-case generation | Site | Form list, cases, test code, reports |
| F-03 | Case editing | Session, edits | Updated cases, regenerated test code |
| F-04 | Regression replay | Session, comparison URL | Run results, visual differences, comparison report |
| F-05 | Scenario recording and saved authentication | Authorization, human interaction | Saved scenario, signed-in state |
| F-06 | Screen exploration | Site | A map of reachable screens (report) |
| F-07 | Dynamic assessment (DAST) | Start URL, scope, scenario, authorization | Findings |
| F-08 | ZAP integration | ZAP API and proxy, permission for active scan | ZAP alerts mapped to test cases |
| F-09 | Static analysis (SAST) | Source directory | Findings (JSON, HTML, Markdown, SARIF) |
| F-10 | Source verification | Individual finding, authorized target, input values | Private verification report |
| F-11 | Sample verification | Sample state, checks, limits | Per-candidate results with evidence, private report |
| F-12 | Genetic search | Sample state, search settings, optional model settings | Per-generation results, independent reproduction, private report |
| F-13 | Three-method comparison | Trial limit, fixed seed set | Aggregated measurements per method |
| F-14 | OpenVEX authoring | Verification results, reviewer input | OpenVEX document |
| F-15 | Mobile assessment (source edition) | Device settings, mobile scenario | Run results |
| F-16 | Optional AI integration | Explicit permission, settings | Assertion results, review results |
| F-17 | Desktop start screen and training | Storage, automation browser | Environment check, installation, practice sites, illustrated guides |

## 4. Functional specification

### 4.1 F-01 Site management

- A site is identified by an identifier limited to letters, digits, hyphens and underscores. Display name, start URL, group name and labels can be set.
- Login settings (login URL and selectors), Basic-authentication use, a saved scenario and crawl limits can be set (maximum depth, maximum pages and maximum cases per form; defaults 3, 30 and 25).
- Usernames, passwords and Basic-authentication credentials are stored only in the site's secrets file and never appear on screen, in reports or in results. Only "configured / not configured" is reported.
- Browser engine (Chromium, Firefox, WebKit), device emulation and client-certificate paths can be set.
- Standard variables, secret variables, shared steps and CSV data sets are managed per site.

### 4.2 F-02 Test-case generation

1. Crawl the same origin from the start URL and extract forms, input constraints and stable selectors.
2. Build normal, boundary and abnormal candidate values for each field with deterministic rules. No AI is used.
3. Combine values pairwise within the maximum number of cases per form.
4. Save the form list, URL list, cases, test code, YAML and HTML/Markdown reports as a session.
- Progress is shown step by step, and a saved session can be chosen for replay.

### 4.3 F-03 Case editing

- Load a session's cases as YAML, edit and save them, and regenerate test code.
- If the case groups are not in a valid form, an error is returned.

### 4.4 F-04 Regression replay

- "Record baseline" records the screen states; "Replay (compare)" runs the same cases and checks differences.
- A comparison URL runs the same cases against another environment, such as a fixed build.
- Pixel-level differences are failures; images and results are kept in the comparison report.
- All traffic can be sent through the ZAP proxy. Combining with active scan requires explicit authorization.

### 4.5 F-05 Scenario recording and saved authentication

- Scenario recording: with a saved site and authorization, open one local visible browser, perform the configured login, and record the user's actions as portable steps. Password entry is never recorded. Other input values are recorded only when separately chosen. Nothing is persisted until the user saves.
- Saved authentication: for apps that need SSO or third-party sign-in, save the result of a manual sign-in (cookies and local storage) so later crawls and explorations start signed in. A third party's own sign-in page is never automated.

### 4.6 F-06 Screen exploration

- Follow same-origin links and operate non-destructive controls outside forms (buttons, tabs, dropdowns) one at a time in an isolated throwaway tab, capturing the resulting screen to build a map.
- Elements inside forms and elements whose labels mean submit, delete, sign out or purchase are reported as skipped, not operated. Forms are never submitted.

### 4.7 F-07 Dynamic assessment (DAST)

- Crawl with a start URL, maximum pages (default 20, up to 100), maximum depth (default 2) and an optional scenario, collecting same-origin traffic.
- It does not start without explicit authorization. Active scan needs a separate authorization and is off by default.
- Passive checks cover missing response headers, use of HTTP, cookie attributes, mixed content, password forms sent by GET and CSRF indicators, and inline event handlers. Each finding has a severity (high, medium, low, info), an OWASP Top 10 category, evidence and remediation.
- No forms are submitted and no intrusion is attempted.

### 4.8 F-08 ZAP integration

- Check that a local ZAP (API on localhost only) prepared by the user is reachable.
- When enabled, collected traffic passes through the ZAP proxy and ZAP's existing rules (passive, and active when permitted) are applied.
- ZAP alerts are mapped to test cases by URL and a per-case identifying header. Alerts are not mechanically assigned to a single OWASP category; they are marked "needs review".

### 4.9 F-09 Static analysis (SAST)

- Analyze a local source directory read-only. Source is never modified.
- Up to 3,000 files of 1 MiB or less in common text formats are analyzed; dependency folders, version-control data and build output are excluded.
- Signs detected: dynamic code execution, command-execution APIs, SQL string concatenation, hard-coded secrets, disabled TLS verification.
- Each finding carries an individual identifier, the source SHA-256, an exact position, severity, OWASP category, evidence and remediation. File-local Express route candidates are mapped, but ambiguous or dynamic definitions are shown as "cannot be mapped" and are never used as authorization to execute or as evidence of reachability.
- Results are written as JSON, HTML, Markdown and SARIF only to a location reserved for analysis results.

### 4.10 F-10 Source verification

Verification that ties a static-analysis result to a running local target.

- **Built-in sample**: analyze the bundled sample, check source against the authorized target, then send a normal control and a candidate.
- **Authorized target**: choose only a unique route and send a normal control and a candidate anonymously to a JSON API on an explicitly authorized numeric loopback address (HTTP, given port).
- **Input values**: specify, as JSON, the normal-control values, candidate values, and the expected response fields and HTTP status.
- **ZAP environment (optional)**: install ZAP and its runtime from the screen and collect passive evidence in a dedicated session per trial. Ordinary verification works without it.
- A candidate is not sent if the normal control does not succeed. Source is checked before and after sending; a change invalidates the evidence. Source-only results stay "under investigation", and neither findings nor warnings establish a vulnerability or safety.

### 4.11 F-11 Sample verification

- Verify a bundled synthetic-data sample in three states: baseline, deliberately changed and fixed. No external site is contacted.
- Checks: boundary and Unicode, ownership, and confirmation-to-completion workflow. Run all or one.
- Set a random seed, candidate limit, trial limit (including normal controls) and time limit. The same seed, settings and code reproduce the candidate order.
- Progress is shown and runs can be cancelled. Cancellation, deadline, trial limit, failed normal control and source change are shown separately from completion.
- Results show a per-candidate verdict (violation reproduced / no violation within the trials / under investigation), reachability (reached, blocked, unmeasured), evidence and an HTML report.

### 4.12 F-12 Genetic search

- Search a synthetic sample whose violation needs three conditions at once, repeating selection, crossover and mutation over generations.
- Initial candidates never contain the answer. The same candidate is never executed twice. The best candidates of a generation are carried forward as parents with their observed results instead of being re-run.
- A candidate counts only when its normal control succeeded and the server-side observation is tied to that trial. The score ranks candidates for the next generation; it is not a verdict.
- A promising candidate is re-executed in a separate session; only what an independent judgment confirms is "independently reproduced".
- Methods: "genetic algorithm" and "fixed rules only". Fixed rules try a fixed list of boundary and power-of-two values in order.
- Settings: generations (up to 100), population (2–64), elite count, tournament size, crossover rate, mutation rate, minimum diversity, stagnation allowance, random seed, trial limit (up to 1,000), time limit (up to 3,600,000 ms), scoring weights.
- Stop reasons: generation limit, stagnation, trial limit, exhausted diversity, time limit, cancellation, failed normal control, source change, timeout, unverified evidence, ZAP incomplete, execution error.
- An optional language model can propose part of the candidates. It is off by default, and the search is complete without it (4.13).

### 4.13 F-13 Three-method comparison

- Compare fixed rules, the genetic algorithm, and the genetic algorithm with a model under the same trial limit, the same sample states and a pre-fixed seed set. The model method runs only when a model is enabled.
- Measured: reproduction rate (independently reproduced runs / valid runs), trials to first reproduction (median), measured points reached, duplicate candidates, time, tokens and cost.
- A reproduction on the fixed sample is highlighted as a false positive. A run that ended for environmental reasons is retried once after a wait; if still invalid it is excluded from the rate's denominator and counted.
- Results are measurements, not a ranking, and no method is guaranteed to be better.

### 4.14 F-14 OpenVEX authoring

- Saved verification results are listed as "evidence", and evidence suggests a status. The only suggestions are "affected" when a result reproduced, and "under investigation" otherwise.
- A statement consists of a vulnerability ID, product ID (a package URL or similar; SHA-256 optional), status, basis (evidence / reviewer's decision), justification, action, notes and evidence references.
- Status rules:

| Status | Requirement |
|---|---|
| Under investigation | Nothing else |
| Affected | An action statement. With the basis "evidence", a reproduced result as well |
| Not affected | A justification (one of five defined values) and the basis "reviewer's decision" |
| Fixed | The basis "reviewer's decision" |

- "Not affected" and "fixed" are never created from findings that found nothing, unobserved results, timeouts, incomplete ZAP runs or source-only results. They are exported as the reviewer's assertion, with a note saying so.
- A named approver approves. Approval re-reads the evidence and fails if a result changed or disappeared. An approved draft cannot be edited.
- To change a document, create a revision: the document ID is kept and the version increases by one.
- The exported document follows OpenVEX v0.2.0 and contains a document ID, author, role, timestamp, version, tooling name and statements.

### 4.15 F-15 Mobile assessment (source edition)

- Setting a site's platform to iOS or Android with a device name, OS version and an app (or bundle ID) runs a mobile scenario through a local Appium server.
- Available operations: tap, fill, wait, wait for element, swipe, screenshot, loop. The host needs Xcode or the Android SDK and a running simulator, emulator or device.

### 4.16 F-16 Optional AI integration

- **AI assertions**: an `aiAssert` scenario step compares a natural-language expectation with text information of the page (visible text and the names and roles of interactive elements). It runs only when enabled explicitly per site and may send page text to the configured external AI service.
- **AI review**: only the currently displayed static-analysis results are handed, with explicit permission, to a local external AI command-line tool for review. Source text, credentials and API keys are not passed.
- Both are off by default and are not used in test-case generation or scanning itself.

### 4.17 F-17 Desktop start screen and training

- The start screen checks the storage location and the automation browser, and installs what is missing from the screen. The first browser installation needs an internet connection.
- It prepares Japanese and English practice sites, and switches them between basic, changed and fixed with buttons.
- Illustrated hands-on guides open from the screen you are working in; opening a guide keeps inputs and results.
- The interface language can be Japanese, English or French.

## 5. External interfaces

The application runs as a local HTTP server that also serves the screens. It is not exposed externally.

### 5.1 Assessment APIs

| Method | Path | Description |
|---|---|---|
| GET / PUT | `/api/sites`, `/api/sites/:id` | List, read and update sites |
| POST / GET | `/api/sites/:id/credentials`, `.../credentials/status` | Save credentials and read their status |
| GET / PUT | `/api/sites/:id/{variables,shared-steps,data-sets}` | Variables, shared steps, data sets |
| GET | `/api/sites/:id/pipeline/run` | Test-case generation (SSE) |
| GET | `/api/sites/:id/sessions` | List sessions |
| GET | `/api/sites/:id/sessions/:sessionId/replay` | Replay (SSE) |
| GET / PUT | `/api/sites/:id/sessions/:sessionId/test-cases` | Read and update cases |
| POST | `/api/sites/:id/sessions/:sessionId/yaml/{export,regenerate}` | Export and regenerate YAML |
| GET | `/api/sites/:id/explore/run` | Screen exploration (SSE) |
| POST / GET | `/api/scenario-recorder/{start,stop,status}` | Scenario recording |
| POST / GET | `/api/auth-session/{start,stop,cancel,status}` | Saved authentication |
| GET | `/api/sites/:id/mobile/run` | Mobile run (SSE) |
| POST | `/api/security/dynamic-scan` | Dynamic assessment |
| POST | `/api/security/zap-status` | ZAP reachability |
| POST | `/api/security/static-scan` | Static analysis |
| GET / POST | `/api/ai/*` | AI review availability and run |
| GET | `/api/system-info` | System information |

### 5.2 Verification APIs

Verification APIs are protected by a session issued at start-up and accept only requests from the same machine and origin.

| Method | Path | Description |
|---|---|---|
| GET | `/api/verifier/session` | Start a session and read defaults |
| POST / GET | `/api/verifier/jobs`, `/jobs/:jobId`, `/jobs/:jobId/cancel` | Start, query and cancel sample verification |
| GET | `/api/verifier/jobs/:jobId/report.html` | View the report |
| POST | `/api/verifier/sast-sample` and related | Source verification (built-in sample, authorized target) |
| POST / GET | `/api/verifier/zap-runtime/*` | Install, query and cancel the ZAP environment |
| GET / POST | `/api/verifier/genetic/{defaults,jobs}`, `/jobs/:jobId`, `/jobs/:jobId/cancel` | Start, query and cancel genetic search and comparison |
| GET / POST | `/api/verifier/vex/{evidence,suggest,drafts}` and related | OpenVEX evidence list, suggestion, draft operations, approval, revision and export |

### 5.3 Command line

| Purpose | Command |
|---|---|
| Start the app | `npm start` (default port 4173) |
| Dynamic assessment | `npm run dynamic-scan -- <URL>` |
| Sample verification | `npm run verifier:run -- --mode baseline|changed|fixed` |
| Genetic search | `npm run verifier:run -- --genetic-fixture` (`--method rules|ga`, `--llm` and others) |
| Three-method comparison | `npm run verifier:run -- --genetic-compare` |
| Environment check and setup | `npm run doctor`, `npm run setup` |

## 6. Data

### 6.1 Storage location

- The desktop edition stores site settings, credentials and results in a per-user data area (for example Application Support on macOS). The location is shown on the start screen and can be changed with an environment variable.
- `npm start` in the source edition stores them inside the repository.

### 6.2 Main data

| Data | Content | Visibility |
|---|---|---|
| Site settings | Identifier, start URL, crawl limits, login settings, browser settings, variables, scenario | On this machine |
| Secrets file | Login and Basic-authentication credentials, secret variables | On this machine; never shown on screen or in results |
| Session | Form list, URL list, cases (JSON, YAML), test code, reports, baseline images | On this machine |
| Static-analysis results | JSON, HTML, Markdown, SARIF | On this machine |
| Verification report | Trials, verdicts and evidence as JSON, and script-free HTML | Private (on this machine, readable by the owner only) |
| Genetic search and comparison reports | Settings, per-generation candidates and scores, stop reasons, independent reproduction, aggregates | Private (same) |
| OpenVEX drafts and exports | Statements, approval details, exported documents | Private (same) |

Verification, search and VEX files contain the actual inputs and identifiers used, so they should not be published.

## 7. Limits and defaults

| Item | Default | Maximum |
|---|---|---|
| Crawl depth / pages / cases per form | 3 / 30 / 25 | — |
| Dynamic assessment pages / depth | 20 / 2 | 100 / — |
| Static analysis files / size per file | — | 3,000 / 1 MiB |
| Sample verification candidates / trials / time | 16 / 128 / 120 s | 64 / 1,000 / 1 h |
| Genetic search population / generations / trials / time | 16 / 8 / 256 / 120 s | 64 / 100 / 1,000 / 1 h |
| Language model calls / retries / response size | 8 / 1 / 16 KiB | 100 / 5 / 64 KiB |
| Language model total tokens / response tokens | 20,000 / 1,024 | 1,000,000 / 8,192 |
| OpenVEX statements / products / evidence | — | 64 / 16 / 16 (64 drafts kept) |

Trial limits include normal-control trials.

## 8. Security requirements

- All assessment is limited to targets the user owns or is explicitly authorized to test. Dynamic assessment, active scan, source verification and scenario recording cannot start without confirming authorization.
- Destinations for source verification and the verification foundation are limited to authorized numeric loopback HTTP. Redirects are not followed and nothing is sent outside the authorized scope.
- Credentials never appear in results, reports or logs. Password entry is not recorded.
- Verification APIs require a session and a same-origin request from the same machine; status and cancellation are allowed only for the session that started the job.
- File serving validates site and session identifiers, is limited to the intended scope, and is rate limited.
- What is given to a language model is limited to typed candidate values and aggregates; URLs, credentials, files and evidence are not. A model cannot change scope, authentication or trial limits.
- The desktop screens reject requests that lack the secret token issued at each start.
- Sending to an external language model requires explicit permission, the name of an environment variable holding the API key, and a cost ceiling. The key itself is not stored or reported. The desktop screens offer only models on this machine.

## 9. Non-functional requirements

- Environments: installers for macOS (Apple Silicon) and Windows (x64). The source edition needs Node.js 24 or later on macOS, Windows or Linux. The installers bundle Node.js.
- All execution is local. Communication goes only to assessment targets, external services the user configured, and official download sources for installations the user starts (browser, ZAP, Java).
- Long operations show progress and can be cancelled. Results ended by cancellation, deadline or limit are saved separately from completed ones.
- The interface fits a fixed size of 960×648 or larger; long results scroll inside their area.
- Interface languages are Japanese, English and French; training material is Japanese and English.
- Apart from installing the browser, no models or additional software are needed.

## 10. Acceptance criteria

- A site can be saved and test-case generation outputs forms, cases and test code.
- YAML can be edited and test code regenerated; baseline recording and comparison work on the same session.
- Dynamic assessment cannot start without confirming authorization. With ZAP integration enabled, alerts are saved mapped to test cases.
- Static analysis does not write to the analyzed source and saves results only to the location reserved for them.
- Sample verification shows no violation on the baseline, the four known violations on the deliberately changed sample, and none on the fixed sample.
- Genetic search reproduces independently only on the deliberately changed sample and not on baseline or fixed. It stops safely on cancellation, limits and invalid settings.
- In the three-method comparison, no method reproduces on the fixed sample, and rates use only valid runs as the denominator.
- OpenVEX cannot be exported before approval and cannot be edited after it. A verification that found nothing cannot by itself create "not affected".
- Results and drafts are stored only in the private area on this machine.

## 11. Notes for use

- Automated findings are leads for review, not confirmation of a vulnerability or a guarantee of safety.
- Finding no violation in a finite number of trials does not prove a target is safe.
- Before assessing production, verify the impact in staging with a small crawl scope and page limit.
