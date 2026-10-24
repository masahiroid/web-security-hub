# Web Security Hub Architecture

[日本語版](ja/ARCHITECTURE.md) · [Specification](SPECIFICATION.md) · [Detailed design](DETAILED_DESIGN.md) · [Screen design](SCREEN_DESIGN.md)

This document shows how the functions in the specification are realized. Processing rules are in the detailed design and screens are in the screen design.

## 1. Design principles

| Principle | Content |
|---|---|
| Local only | Assessment, verification and storage all happen on the user's machine. Results are not transmitted automatically |
| Fixed authorization and scope | Targets, routes, methods, counts and time are fixed and authorized before running. Anything outside is rejected |
| Evidence first | Verdicts come from observations tied to a trial and from independent rules, not from counts, scores or HTTP status alone |
| Search and verdict separated | The score that guides a search is separate from the vulnerability verdict. A violation or safety is never concluded from a score |
| Deterministic | The same input, settings and random seed reproduce the same candidates and order. AI does not replace deterministic generation |
| Fail safe | A failed normal control, missing measurement, timeout, cancellation or source change is "inconclusive" or a stop, never "no problem" |
| Separated responsibilities | Screens, transport, use cases, decision rules and storage are separate; decision rules do not depend on transport or storage |
| Optional features isolated | AI, ZAP and models are off by default; the main functions are complete without them |

## 2. System structure

```text
┌──────────────────────────────────────────────────────────────┐
│ User's machine                                                │
│                                                              │
│  Native shell (desktop) / Browser (source edition)           │
│        │  displays the screens                                │
│        ▼                                                      │
│  Local server ── screens, APIs, progress streaming            │
│        │                                                      │
│        ├─ Assessment    crawl / test generation / replay /   │
│        │                DAST / SAST                           │
│        ├─ Verification foundation                             │
│        │     scope, trials, evidence, verdicts, reports       │
│        │     ├─ Search   genetic search / fixed rules /       │
│        │     │           comparison                           │
│        │     └─ Optional language-model candidate supply      │
│        ├─ VEX           evidence, review, approval, export    │
│        └─ Storage       sites / sessions / private reports    │
│                                                              │
│  Automation browser (Playwright)   Sample server              │
│  Optional: ZAP / Java, Appium, language-model server          │
│            (loopback)                                         │
└──────────────────────────────────────────────────────────────┘
        │ traffic to the target (authorized targets only)
        ▼
   Authorized web application / local API
```

## 3. Components

### 3.1 Layers

| Layer | Responsibility |
|---|---|
| Screens | Settings input, progress and result display, cancellation, links to training. No decisions or storage |
| API | Request validation, authorization, calling use cases, responses. Does not handle assessment details or storage formats directly |
| Use cases | Sequence generation, replay, verification, search, comparison and VEX authoring. Know neither transport nor screens |
| Decision rules (domain) | Scope decisions, verdicts, scoring, search operators and VEX rules. Independent of transport, files and screens |
| Adapters | Interaction with and cleanup of external things: browser, HTTP, files, ZAP, Appium, language models |
| Storage | Saves site settings, sessions, reports and drafts in defined locations, readable only by the owner |

### 3.2 Assessment functions

| Component | Role |
|---|---|
| Crawler and form extraction | Crawls the same origin and obtains forms, fields, constraints and stable selectors |
| Value generation and combination | Builds normal, boundary and abnormal values deterministically from field constraints and combines them pairwise |
| Test-code generation and replay | Turns cases into test code and runs it against a baseline |
| Scenario runner | Replays login and action sequences with one shared runner (used by both test generation and dynamic assessment) |
| Scenario recording and saved authentication | Records human actions and saves manual sign-in results |
| Screen exploration | Tries non-destructive actions in isolated tabs and maps transitions |
| Dynamic assessment | Inspects collected traffic and screens with passive rules |
| ZAP integration | Uses ZAP's proxy and API and maps alerts to cases |
| Static analysis | Inspects local source with rules and attaches individual identifiers and positions |
| Reporting | Outputs JSON, HTML, Markdown and SARIF |

### 3.3 Verification foundation

A common foundation for "send trials only inside the authorized scope, with a normal control first, and decide with tied evidence". Sample verification, source verification and genetic search share it.

| Component | Role |
|---|---|
| Scope registration | Bundles target origin and port, route, method, fields, authentication profiles, deadline, trial count, concurrency and source location into one "authorization", rejecting out-of-scope use, expiry and substitution of another profile |
| Trial execution | Creates an independent transport context per trial and sends the normal control, then the candidate. Redirects are not followed, and cleanup always happens on cancellation, deadline or timeout |
| Measurement and correlation | Ties server-side observations to five identifiers (job, trial, seed, request, authentication profile) and to the source identifier (SHA-256) |
| Verdict | Decides with an independent business rule, distinguishing normal, blocked and reached. HTTP status alone is never used |
| Source check | Confirms the source identifier before and after a trial and rejects evidence if it changed |
| Passive evidence (optional) | Collects passive alerts in a dedicated ZAP session per trial, tied to the trial by the five identifiers and the message |
| Result storage | Saves settings, candidates, verdicts and evidence as a private report |

### 3.4 Search and comparison

| Component | Role |
|---|---|
| Genes and individuals | A set of fields with defined types and value vocabularies is the "gene"; an individual has lineage (parents, operator). Destination and authentication are not part of a gene |
| Generation operators | Selection, crossover, mutation, elite carry-over, duplicate elimination and diversity maintenance |
| Scoring | Only valid observations are scored; missing and zero are distinguished. The score is used for ranking only |
| Search control | Stops on generation, trial, time, stagnation, diversity or cancellation, and records the reason |
| Independent reproduction | Re-executes a found candidate in a separate session and confirms it with an independent verdict |
| Fixed rules | A deterministic baseline that does not learn from results |
| Comparison | Runs methods, states and seeds aligned and aggregates measurements. Environment failures are retried and excluded when still invalid |

### 3.5 Language-model candidate supply (optional)

- Only typed candidate values and aggregates are passed. URLs, authentication, files, evidence and identifiers are not.
- Replies are checked against a strict schema listing allowed values per gene. Invalid, truncated, refused, oversized or duplicate replies are not executed; after a limited number of retries the search continues without the model.
- Calls, tokens and cost have ceilings checked before each call. Candidates only replace part of the slots; the trial limit does not change.
- The default destination is this machine (loopback). Sending outside needs explicit permission and a cost ceiling.

### 3.6 OpenVEX

| Component | Role |
|---|---|
| Evidence summary | Re-derives reproduced, not reproduced or inconclusive from stored reports. A reviewer cannot choose an observation |
| Rules | Check required fields per status and forbid statuses that evidence cannot establish |
| Review and approval | A named approver approves; evidence is re-read at approval and the draft is frozen afterwards |
| Revision | Creates a new draft with the same document ID and a higher version |
| Export | Only an approved draft becomes an OpenVEX document |

### 3.7 MCP server (source edition)

| Component | Role |
|---|---|
| Permissions | Chosen by the person starting the server (summaries only by default; run, code snippets and VEX are separate opt-ins). Tools the permissions do not allow are not offered |
| Tool layer | Checks the permission, then a per-minute rate limit, then validates values; runs jobs through the same services as the app, one at a time, and returns aggregate results |
| Protocol adapter | Describes tools and schemas, rejects malformed arguments before any tool runs, and turns refusals into tool errors with stable codes |
| Standard output guard | Keeps standard output for protocol messages only; console output goes to standard error |

Approval of VEX drafts is deliberately absent: a named person approves in the app.

## 4. Desktop edition

- A native shell starts the local server with a bundled runtime and shows its screens. Node.js does not need to be installed.
- The server listens on loopback only and accepts only requests carrying a secret token issued at each start.
- Closing the app ends the server and any helper processes the app started (such as ZAP). Helpers are also reclaimed if the parent ends abnormally.
- Storage is a per-user data area. The automation browser, ZAP and Java are installed at the user's request from pinned, verified versions.

## 5. Main flows

### 5.1 Test generation and regression

```text
Site settings → crawl and form extraction → candidate values → pairwise → cases
        → test code, YAML, reports → saved as a session
Session → record baseline → replay (comparison URL optional) → differences and results
```

### 5.2 Dynamic assessment and ZAP

```text
Authorization → crawl and scenario → collect traffic → passive rules → findings
          └─ ZAP on → traffic through proxy → get alerts → map to cases
```

### 5.3 A verification trial

```text
Register authorization → normal control → (success) → candidate → get observations
        → independent verdict → report
                  └─ (failure) → candidate is not sent; stop
Before and after each trial: check source change, cancellation and deadline
```

### 5.4 Genetic search

```text
Initial candidates → evaluate (with normal control) → select, cross, mutate
        → evaluate only new candidates → check stop conditions
        → promising candidate → independent reproduction in a separate session → report
(optional) model candidates replace part of the GA's candidate slots
```

### 5.5 OpenVEX

```text
Verification report → evidence summary → suggested status → statement
        → approval (evidence re-checked) → export → (on change) revision
        → higher version, approved again
```

## 6. Security design

| Aspect | Design |
|---|---|
| Trust boundary | Screens and APIs stay on one machine and are not exposed externally. The only thing trusted is the scope fixed on the server side |
| Authorization | Assessment, sending and recording require authorization. Verification needs a session and same origin, and only the owner of a job can query or cancel it |
| Secrets | Credentials are stored only in a dedicated secrets file and never in results, reports or logs. Password entry is not recorded |
| Input validation | Values from outside are checked for type, length, vocabulary and unknown fields before use. Items not on an allow list are rejected |
| Sending control | Destinations are limited to authorized numeric loopback, redirects are not followed, nothing is sent outside the scope, and reading responses is bounded |
| Models | Off by default. Information is minimized, replies are validated, budgets are not exceeded, and scope or authority cannot be changed |
| File serving | Identifiers are validated, access is limited to the intended scope and rate limited. Read and write locations are separate |
| Private storage | Results are stored readable by the owner only. Reports contain no scripts and inputs are escaped |
| Cleanup | Browsers, helper processes and temporary files are reclaimed on cancellation, deadline or abnormal end |

## 7. Storage design

```text
data area/
  sites/<site>/          site settings, secrets, scenarios, data sets, sessions
  artifacts/
    static-scans/        static-analysis results
    private/             private reports for verification, search, comparison, VEX (owner only)
```

- Private areas are created with restricted permissions and reject symbolic links and unexpected locations.
- Reports are written in one step; an unfinished state is never published (it is finalized after writing completes).
- The number and size of stored items are bounded.

## 8. External integrations

| Integration | Purpose | When enabled |
|---|---|---|
| Playwright | Driving the automation browser | Always used (installed by the user) |
| OWASP ZAP | Rule-based inspection, passive evidence | Enabled and installed by the user |
| Appium | Mobile operation | Source edition, when the site platform is iOS or Android |
| Language-model server | Proposing candidates | Configured by the user; loopback only on the screens |
| External AI command-line tool | Assertions, result review | Explicit permission per site and per run |

## 9. Design constraints

- Crawling alone cannot cover SPAs, SSO, multi-step wizards and role-specific screens completely. Use scenarios as well.
- Mapping ZAP alerts to cases relies on URL and an identifying header; server-side redirects and similar can prevent a unique match.
- Static analysis is lightweight rule-based inspection, not a substitute for data-flow analysis or dependency vulnerability scanning.
- Source-only results do not prove identity with running code, so they are always treated as "under investigation".
- The result of a finite number of trials is not proof of safety.
