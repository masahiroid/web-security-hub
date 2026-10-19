# Changelog

## Unreleased

- Update the source-only mobile toolkit to WebdriverIO 10.1.0, removing the vulnerable extract-zip dependency path (CVE-2026-56876 / GHSA-jmr9-qjv8-65gv and GHSA-7pqw-9j4j-h8q3). Source checkouts need Node.js 22.19.0 or later; existing desktop installer assets are unchanged. A loopback W3C session regression test verifies session creation and deletion; hardware acceptance remains separate.
- Add strict ESLint checks, push/PR/weekly quality and CodeQL analysis, dependency updates and release gates. Preserve original causes in wrapped errors.
- Publish the private vulnerability reporting process and clarify security, testing and cryptography practices.

## 3.0.0

- Individual SAST finding identities, source digests/spans and bounded file-local Express route attribution; ambiguous/unsupported routes stay explicit.
- Desktop sample and explicitly authorized local JSON API verification, normal-control-first execution, source rechecks and cancellation. Source-only results remain under investigation.
- Optional GUI/CLI installation of pinned ZAP and Java, fresh owned sessions, passive evidence correlated by five IDs and message ID, bounded queue waits and parent-death cleanup.
- Private JSON/HTML source reports, inline report reading, bilingual illustrated instructions and five control tabs within the desktop workspace.
- Strict TypeScript additions, transport/lifecycle/evidence separation and bounded anonymous response streaming. Existing fixture campaigns and CLI remain available.
- Updated optional-toolkit dependency overrides; remaining source-only archive advisory scope is documented in SECURITY.md.

## 2.0.0

Local deterministic fixture campaigns, private evidence reports, bilingual desktop training, notarized macOS and Windows installers.
