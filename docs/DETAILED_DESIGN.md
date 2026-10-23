# Web Security Hub Detailed Design

[日本語版](ja/DETAILED_DESIGN.md) · [Specification](SPECIFICATION.md) · [Architecture](ARCHITECTURE.md) · [Screen design](SCREEN_DESIGN.md)

For each component in the architecture, this document gives the processing steps, rules, states, data items and error handling.

## 1. Site settings

### 1.1 Data items

| Item | Type | Content and constraints |
|---|---|---|
| Identifier | String | Letters, digits, hyphens, underscores. Becomes the storage name. Required |
| Display name | String | For display |
| Start URL | URL | Where crawling starts. Unused for mobile |
| Platform | Choice | web / ios / android. Default web |
| Crawl | Settings | Maximum depth, maximum pages, maximum cases per form, normal-only pairwise, dry run, visible browser, fail fast, success marker |
| Login | Settings | Login URL and selectors for username, password and submit (credentials excluded) |
| Basic authentication | Settings | Whether used (credentials excluded) |
| Browser | Settings | Engine (Chromium / Firefox / WebKit), device name, client-certificate origin and relative paths |
| Variables | Map | Standard variables, referenced by name in scenarios |
| Scenario | Settings | Steps replayed before crawling or running, and a data-set name for repetition |
| Scenario expansion | Array | Definitions for declarative case expansion |
| Mobile | Settings | Device name, OS version, app path or bundle ID |
| Group and labels | String, array | For organization |
| AI assertions | Settings | Enabled or not, and language. Default off |

### 1.2 Rules

- On save, the whole configuration is validated against a schema; unknown items and out-of-range values are rejected.
- Credentials are stored in a secrets file separate from the settings. Responses never contain values, only whether they are set.
- Relative paths in settings resolve inside the site's folder; paths pointing outside are rejected.

## 2. Test-case generation

### 2.1 Steps

1. Build run settings from the settings and secrets. If a scenario exists, replay it first to be signed in.
2. From the start URL, follow same-origin links breadth-first without exceeding maximum depth and maximum pages.
3. Extract forms and fields on each page: type, required, length, range, options, label and a stable selector.
4. Build candidate values for each field (2.2).
5. Combine values pairwise within the maximum cases per form.
6. Save the form list, URL list, cases, test code, YAML and reports to the session.

### 2.2 Candidate-value rules

| Field kind | Normal | Boundary | Abnormal |
|---|---|---|---|
| Options (select, radio) | A contextually valid option | The last valid option | A value not among the options |
| Checkbox | On | Off | — |
| Number, range | Midpoint | Minimum, maximum | Out of range |
| String | A plausible value inferred from label and type | Minimum and maximum length | Too long, empty, special characters |
| Japanese address, phone, kana | Default in a common format | Digit-count boundaries | Format violations |

- Values come only from deterministic rules over HTML constraints, input type and label; the same input yields the same values.
- Duplicate values are removed. Each value carries its rationale.

## 3. Replay and comparison

- Baseline recording: run the session's test code and save each screen state as the reference.
- Replay: run the same cases and compare pixel by pixel. Any difference is a failure; difference images and results are saved in the comparison report.
- With a comparison URL, the same cases run against another environment.
- With ZAP, all traffic goes through the proxy with a per-case identifying header. Active scan does not run without the authorization confirmation.

## 4. Scenario execution

### 4.1 Step kinds

| Kind | Behavior |
|---|---|
| goto | Navigate to a URL |
| click / fill / check / uncheck / select | Operate, enter or choose on an element |
| wait | Wait for time or an element |
| back / forward / reload | History navigation and reload |
| setFile | Upload a file from the site's dedicated folder |
| download | Save a download to the site's dedicated folder |
| branch | Branch on element existence, visibility or text |
| loop | Repeat a given number of times |
| useSharedStep | Expand a shared step group |
| aiAssert | Check a natural-language expectation (enabled sites only) |

- Steps are validated before running; unsupported kinds and invalid values are rejected.
- Values can reference standard and secret variables by name. Secret values never appear in results.
- With a data set (CSV), the scenario repeats once per row.
- Test generation and dynamic assessment use the same runner, so behavior matches. Generated test code embeds the same behavior.

### 4.2 Locator self-healing

- When recording, each action stores structural information (tag, ID, test attribute, name, role, label, placeholder, text, classes). Values are not stored.
- At run time, if the primary selector is not found within a few seconds, candidates derived from the structural information are tried; failing that, same-tag elements are scored by similarity and the closest is used.
- Every heal is logged and collected into the results. Nothing is replaced silently.

### 4.3 Scenario recording

- With a saved site and authorization, one visible browser is started.
- The configured login runs with server-side credentials, then the user's actions are normalized into portable steps.
- Password entry is always excluded. Other input values are included only when the user separately chooses so.
- On stop, steps are returned to the screen. They become part of the site settings only when the user saves.

## 5. Dynamic assessment (DAST)

### 5.1 Steps

Confirm authorization → replay scenario (optional) → crawl same origin → collect traffic → passive checks per page → aggregate results

- Collected traffic is de-duplicated. No forms are submitted and no intrusion is attempted.
- Active scan is requested from ZAP only when it is both enabled and authorized.

### 5.2 Passive checks

| Check | Severity | OWASP category |
|---|---|---|
| Missing Content-Security-Policy | high | A05 |
| HTTP used instead of HTTPS | high | A02 |
| Missing Strict-Transport-Security | medium | A02 |
| Missing X-Frame-Options | medium | A05 |
| Cookie without the Secure attribute | medium | A02 |
| Mixed content | medium | A02 |
| Missing X-Content-Type-Options | low | A05 |
| Missing Referrer-Policy | low | A05 |
| Missing Permissions-Policy | low | A05 |
| Password form sent by GET, CSRF indicator on authentication forms, inline event handlers | Varies | Varies |

Each finding has an identifier, title, severity, OWASP category (name and reference), location, evidence and remediation.

## 6. ZAP integration

- Reachability check: connect to the given API URL, for example by reading the version. The API is expected to be on localhost only.
- Traffic path: point the automation browser's proxy at ZAP and add a per-case identifying header.
- Alert retrieval and mapping: retrieve alerts and map them to cases by alert URL and the identifying header kept in the history. Results are saved as pairs of alert and case IDs.
- Classification: ZAP alerts carry CWE and WASC, so they are not assigned to one OWASP category but marked "needs review".

## 7. Static analysis

### 7.1 Steps

1. Confirm the given directory exists and is readable.
2. Collect files with a target extension and at most 1 MiB, up to 3,000. Dependency folders, version-control data and build output are excluded.
3. Apply the rules to each file and record matching positions.
4. Attach to each finding an individual identifier, the file's SHA-256, a character range and a line number.
5. Aggregate by severity and save as JSON, HTML, Markdown and SARIF.

### 7.2 Rules

| Rule | Severity | OWASP category |
|---|---|---|
| Dynamic code execution | high | A03 |
| Reference to a command-execution API | medium | A03 |
| Suspected SQL string concatenation | high | A03 |
| Suspected hard-coded secret | high | A02 |
| Disabled TLS certificate verification | high | A02 |

### 7.3 Route mapping

- Express route definitions in the same file are parsed to show which route's handler a finding falls inside, as candidates.
- Handlers shared by several routes are "multiple candidates"; dynamic registration and unsupported syntax are "cannot be mapped".
- Candidates are never used as authorization to execute or as evidence of reachability.

## 8. Verification foundation

### 8.1 Authorization (scope)

| Item | Content |
|---|---|
| Target | Origin and port. Numeric loopback only |
| Route and method | One authorized route and HTTP method |
| Fields | The list of items that may be sent |
| Authentication profile | Only pre-registered names. Actual credentials are not passed |
| Source location | A read-only root used for checking |
| Deadline, trials, concurrency | Deadline, trial ceiling, number of simultaneous executions |

An authorization is validated when created, and expiry, cancellation, exceeding limits, substitution outside the scope and redirects are rejected.

### 8.2 Trial flow

1. Obtain permission for one trial from the authorization (consuming the ceiling).
2. Run each authentication profile's preparation steps in an independent transport context.
3. Send the normal control. If the response is not as expected, stop and do not send the candidate.
4. Send the candidate. Redirects are not followed.
5. Retrieve server-side observations and adopt only those tied to this trial by the five identifiers and the source identifier.
6. Check the source identifier before and after the trial; a change invalidates the evidence.
7. Decide the verdict (8.4).
8. Close the transport context, also on cancellation, deadline or timeout.

### 8.3 Observation and correlation

- Observations are recorded as events at key points on the server side (just before a guard, just before a commit and so on).
- Each event carries five identifiers (job, trial, seed, request, authentication profile) and the source identifier.
- With no measurement the result is "unmeasured"; with a mismatched source identifier the evidence is not adopted. Reached, blocked and unmeasured are distinguished.

### 8.4 Verdict

| Verdict | Condition |
|---|---|
| Violation reproduced | A state violating an independent business rule was confirmed by tied observations |
| No violation within the trials | The normal control succeeded, observations are valid, and no violation was confirmed |
| Under investigation | Cannot be judged: no measurement, failed normal control, mismatched observation, timeout, cancellation, source-only result and so on |

- The verdict uses an independent business rule (for example, a non-owner must not be able to commit), not HTTP status or a score.
- "No violation within the trials" is not proof of safety.

### 8.5 Job states

```text
Start → Running → Completed / Cancelled / Deadline / Trial limit / Normal control failed / Source changed / Timeout / Error
```

- One job runs at a time. Up to 8 jobs are kept, discarding the oldest finished ones first.
- A job can be queried and cancelled only by the session that started it.

### 8.6 Reporting

- Settings, candidates, observations, verdicts and stop reasons are saved as JSON, with the same content as script-free HTML.
- Saving writes to a temporary area and then finalizes. Size is bounded.

## 9. Source verification

| Mode | Content |
|---|---|
| Built-in sample | Analyze the bundled sample's source, check routes against the authorized target, then send a normal control and a candidate |
| Authorized target | Choose only a unique route from analyzed findings. Send a normal control and a candidate anonymously to an authorized loopback API |

- Input values are JSON objects: normal-control values, candidate values, and the expected response fields and HTTP status of the normal control.
- Source is re-read and its identifier checked before and after sending. A change invalidates the warning.
- Results are "under investigation". Re-reading source does not prove identity with the running code.
- With the ZAP environment, a dedicated session is created per trial, passive alerts are tied to the trial and the session is reclaimed at the end. Alerts are not used to confirm a vulnerability.

## 9A. ZAP environment installation and running

- Installation: obtain pinned versions of ZAP and Java from official sources, verify size and SHA-256, and unpack into the user's data area. It can be cancelled.
- Running: start with an application-specific process, home and session. An existing shared ZAP is never touched. The API is used mostly read-only.
- Reclaiming: on cancellation, exit or abnormal end of the parent, the started process and session are reclaimed.

## 10. Sample verification

### 10.1 The sample

- A bundled synthetic-data server. It has four roles (owners A and B, administrator, anonymous) and supports reading, confirming and completing a record, and boundary inputs.
- Three states: baseline, deliberately changed (containing four violations such as a skipped confirmation) and fixed.
- State is reset for each run and the build carries an identifier (source SHA-256).

### 10.2 How candidates are made

- Candidate order is decided deterministically from the random seed.
- Candidates per check: boundary and Unicode (length, normalization differences, missing fields, supplementary-plane characters), ownership (owner, another user, administrator, anonymous), confirmation-to-completion (with confirmation and with it skipped).
- Identical content is removed while keeping the role; anything above the limit is cut.

### 10.3 Running and stopping

- Candidates run in order, each with a normal control. The run stops on the trial, time or candidate limit, cancellation, failed normal control or source change, and records the reason.

## 11. Genetic search

### 11.1 Individuals and genes

- Gene vocabulary: for each field, the list of possible values (all one type) and whether omission is allowed. Omission and null are distinct.
- Individual: values per gene, an identifier, a generation, parent identifiers and the operator (initial, crossover, mutation, immigrant, model).
- Destination, authentication and authority are not part of a gene.

### 11.2 Scoring

| Item | Content |
|---|---|
| Validity | The normal control succeeded, the observation is tied to the trial, and the source identifier matches |
| Score | Sum, with configured weights, of reachability, coverage of measured points, novelty (points not seen before) and new ZAP alerts |
| Missing data | Unmeasurable items are "missing", not 0. ZAP not finished is "incomplete" |
| Not rewarded | HTTP status, repeated warnings |
| Use | Only ranking to choose parents for the next generation. Never a verdict |

### 11.3 Generation operators

1. **Parent selection**: choose parents from valid individuals by tournament selection (given size). Invalid individuals are never parents.
2. **Crossover**: with the given probability, swap values of two different parents at one point so both parents contribute.
3. **Mutation**: with the given probability, change one changeable gene to a different value (or omit it).
4. **Elites**: the top individuals by score are carried to the next generation as parents with their observed results, without being re-run.
5. **Duplicate elimination**: a gene combination already evaluated is never proposed again. Only new candidates are evaluated in the next generation.
6. **Immigrants**: when breeding alone cannot produce new candidates, after a bounded number of attempts random candidates restore diversity.
7. **Diversity**: if the number of new candidates cannot reach population × minimum diversity (at least 2), stop as "diversity exhausted".
8. Randomness is generated deterministically from the seed; the same seed, settings and observations reproduce the same generations.

### 11.4 Stop conditions

Generation limit, stagnation (the best value did not improve for the given number of generations), trial limit, exhausted diversity, time limit, cancellation, failed normal control, source change, timeout, unverified evidence, ZAP incomplete and execution error. Completed generations are kept even if the run stops partway.

### 11.5 Reserving trials

- For each candidate, two trials (normal control and candidate) are reserved conservatively; the candidate is not run if it would exceed the ceiling.
- If an evaluation call does not respond to cancellation, waiting is cut off and a late result is not adopted.

### 11.6 Independent reproduction

- After the search, choose a promising candidate: valid scoring and a verdict of "violation reproduced".
- In a new session (new server, new authorization), re-run only that candidate.
- It is "independently reproduced" only when all hold: the normal control succeeded, the observation is valid, the source identifier equals that of the search, the job differs from the search's, an event showing the violation exists, and the verdict is "violation reproduced".
- Otherwise the result is "not reproduced" or "inconclusive".

### 11.7 Fixed rules

- Combinations of fixed values per field (boundary and power-of-two values) are tried in a fixed order. They do not learn from results.
- Stop conditions, budget and report shape are the same as in genetic search.

## 12. Three-method comparison

- Combinations: state (default deliberately changed and fixed) × method (fixed rules, GA, and GA with model when a model is enabled) × seed. Fixed rules are deterministic, so once per state.
- A pre-fixed seed set and the same trial limit are used.
- Measured from one run: whether independently reproduced, trials to first reproduction, measured points reached, duplicate candidates, time, tokens and cost, and the stop reason.
- Aggregation: per method × state, valid runs, reproduced count, reproduction rate, median trials to first reproduction, mean points, duplicates and time, total tokens and cost, and the stop-reason breakdown.
- Valid run: one that ended by generation limit, stagnation, trial limit or exhausted diversity. Others (failed normal control, errors and so on) are treated as environmental and retried once after a wait. If still invalid, they are reported but not counted in the denominator.
- If cancelled, results so far are saved as "incomplete".

## 13. Language-model candidate supply

### 13.1 Settings

| Item | Content |
|---|---|
| Mode | Off / mock / model on this machine / external service |
| Destination | Numeric loopback HTTP for a model on this machine. For an external service, an https origin without credentials, path or query |
| Model name | Name passed to the destination |
| Share of candidates | The share of non-elite slots given to the model (default 25%). Separate from the GA's crossover and mutation rates |
| Budget | Ceilings and prices for calls, retries, response size, response tokens, total tokens, time and cost |
| Permission to send externally | Needed only for an external service. The API key is held only as an environment-variable name |

### 13.2 Processing

1. At the end of each generation, compute how many candidates may be requested (slots × share). Do not ask if 0.
2. Build what is passed: the gene vocabulary (items and allowed values) and the values, scores and reachability of top individuals. Identifiers and transport details are excluded.
3. Before calling, check call, token and cost ceilings. Cost compares the estimated input plus the maximum response with the remaining amount.
4. Check the reply: size, JSON shape, missing or extra items, types and allowed values. Duplicates are dropped; any violation discards the whole reply.
5. Failures are retried a limited number of times; if still failing, the search continues without the model. The reason is recorded with a fixed code (too large, invalid shape, unknown field, invalid value, truncated, refused, transport, time, call limit, token limit, cost limit, empty); the model's raw output is not recorded.
6. Accepted candidates, limited to combinations not yet evaluated, are placed ahead of the GA-bred candidates and adopted up to the population size. The trial limit does not change.

### 13.3 Mock

- A deterministic stand-in for trying the feature without a model. It returns values near the best candidates. It is not a language model.

## 14. OpenVEX

### 14.1 Data items

| Unit | Items |
|---|---|
| Draft | Draft ID, document ID, version, author, role, created and updated times, statements, review (state, approver, approval time) |
| Statement | Vulnerability ID, description, product (ID, SHA-256), status, basis, justification, impact statement, notes, action, time, evidence |
| Evidence | Kind (sample, genetic search, source), report ID, observation (reproduced, not reproduced, inconclusive), source identifier, creation time |

### 14.2 Deriving an evidence observation

| Kind | Reproduced | Not reproduced | Inconclusive |
|---|---|---|---|
| Sample verification | Completed with one or more reproductions | Completed with zero reproductions and zero inconclusive | Anything else (cancelled, deadline, limits, mixed inconclusive) |
| Genetic search | Independent reproduction held | The search ended normally and no reproduction held (including nothing to reproduce) | Anything else (cancelled, timeout, stopped early, inconclusive) |
| Source verification | — | — | Always inconclusive (identity with running code is not proven) |

The observation is decided by re-reading the stored report. A reviewer cannot specify it.

### 14.3 Checking a statement

1. Input is validated in a closed form: the vulnerability ID is letters, digits and a few symbols; the product ID is a URI-form string (such as a package URL); SHA-256 is 64 hex digits; description and notes are within length limits; status and justification are defined values. Unknown items are rejected.
2. Evidence references take only kind and report ID; the system derives the observation. A report that does not exist is rejected.
3. The status rules (specification 4.14) apply. With the basis "evidence", statuses evidence cannot establish (not affected, fixed) cannot be created.

### 14.4 Approval, revision and export

- Approval: needs the approver's name. It succeeds only when there is at least one statement and all evidence, re-read, equals what was stored and satisfies the rules. After approval, editing and deletion are not possible.
- Revision: create a new draft from an approved one. The document ID is the same, the version rises by one and statements are carried over.
- Export: only approved drafts. It outputs the document ID (a UUID-form identifier), author, role, approval time, version, tooling name and statements. Each statement outputs vulnerability, time, product (identifier and hash), status, justification, impact statement, action and its time, and notes. A "not affected" or "fixed" asserted by the reviewer gets a note to that effect added to the notes.
- The same approved draft always exports the same content.

## 15. Stop reasons and errors

| Category | Reason | Handling |
|---|---|---|
| Completed | Generation limit, stagnation, trial limit, exhausted diversity | Result adopted |
| User action | Cancellation | Results so far are saved and shown as incomplete |
| Deadline | Time limit, job deadline | Results so far are saved, distinguished from completion |
| Environment, target | Failed normal control, timeout, transport error | Inconclusive. Retried in comparison |
| Evidence | Source change, unverified evidence, ZAP incomplete | Evidence not adopted; inconclusive |
| Input | Invalid settings, outside scope, unknown items | Rejected before running |
| Model | Invalid reply, limit exceeded | The reply is discarded and the search continues without the model |

## 16. Screens and processing

| Screen | Main processing |
|---|---|
| Site management | 1, 4.3, 5 (saving and recording) |
| Test case creation | 2 |
| Replay | 3, 6 |
| Dynamic assessment | 5, 6 |
| Static analysis | 7, 9, 9A |
| Sample verification | 8, 10 |
| Search (GA) | 11, 12, 13 |
| VEX | 14 |
