# Inspect individual SAST findings and route attribution

[日本語](SAST-MAPPING.ja.md) · [Basic hands-on](README.md)

This feature is on the development branch for 3.0.0. It is not included in the published 2.0.0 installers.
Use the source edition with `npm install` and `npm start`.

## 1. Analyze the teaching source

Open **Static Analysis**, enter the absolute path to `training/sast/routes` in this checkout, and run analysis.
These files are read-only teaching inputs. Do not launch them with Node or deploy them to a server.

Three `SAST-DANGEROUS-EVAL` findings appear. They share a rule ID but have separate finding instance IDs.
Expand **Route mapping** to inspect source SHA-256, line/column span and static candidates.

![Individual SAST identities and route attribution](images/sast-mapping-en.png)

## 2. Compare unique, ambiguous and unavailable mappings

| File | Display | Meaning |
|---|---|---|
| `mapped.js` | One candidate | A direct local helper call is attributed to `POST /api/calculate` |
| `ambiguous.js` | Ambiguous | Shared code is registered for `POST /first` and `POST /second` |
| `dynamic.js` | Unavailable | An environment-dependent path is not guessed |

One candidate means one supported registration in the same file. It does not establish runtime reachability, reproduce a vulnerability or grant permission to test a target. This feature does not send HTTP requests.

## 3. Track findings in reports

![Instance identity, source hash and route details](images/sast-mapping-detail-en.png)

JSON, HTML, Markdown and SARIF reports retain the instance ID, source hash and mapping metadata. SARIF preserves the original `ruleId`; instance IDs are added as `partialFingerprints`.
Identical file bytes, relative path and match position produce the same ID. Editing the source changes the ID. Do not reuse an old result as evidence for modified source.
Lines/columns are one-based; offsets and columns use UTF-16; the end of a span is exclusive.

## Coverage and remaining work

Supported inputs are `.js`, `.cjs` and `.mjs` with top-level Express creation, literal route/mount paths, and local handlers, middleware and directly called helper functions. Parameterized paths are displayed as templates.
Imported routers/handlers, factories, dynamic/conditional/computed/chained registrations and analysis limits do not yield a unique conclusion. Existing SAST findings in TypeScript and other languages remain visible, with route mapping marked unsupported.

Connecting findings to an authorized execution scope, correlating per-trial ZAP evidence and validating the 3.0.0 installers remain within this phase.
