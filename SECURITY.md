# Security and dependency scope

Use only targets you own or are explicitly authorized to test. Source analysis never grants permission to send requests. Source-verification results remain under investigation without runtime instrumentation and an independent oracle.

The desktop runtime manifest is intentionally separate from the source automation toolkit. Appium, its iOS driver and WebdriverIO are not bundled in desktop installers. Optional managed ZAP/Java are downloaded only on request, from pinned official releases with size/SHA-256 verification. Private reports and local signing configuration are excluded from Git and release bundles.

The published 3.0.0 desktop runtime has a separate lockfile and does not include the optional mobile automation toolkit. The 3.0.0 source toolkit used WebdriverIO 9 and inherited high-severity `extract-zip` advisories through its browser downloader. The current source updates WebdriverIO to 10.1.0, removing that dependency path. Run the audits below against the current lockfiles; a clean result describes the advisory database at that time, not a guarantee of absence of vulnerabilities. Previously downloaded 3.0.0 source checkouts must update; this change does not replace existing installer assets. Retain the `shell-quote` and `basic-ftp` overrides until upstream ranges include the fixes.

```sh
npm audit --audit-level=moderate
npm audit --audit-level=moderate --prefix desktop/runtime
```

References: [extract-zip symlink traversal](https://github.com/advisories/GHSA-jmr9-qjv8-65gv), [extract-zip directory traversal](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3).

日本語：許可された対象のみで実施してください。ソース版の WebdriverIO を10.1.0へ更新し、既知の extract-zip 脆弱性を含む依存経路を除去しました。既存の3.0.0ソース版は更新が必要です。配布済みインストーラーはこの変更で差し替えていません。監査結果はその時点の既知情報に基づきます。内部資料・秘密情報・実署名設定は公開しません。

## Reporting a vulnerability

Do not disclose vulnerabilities, credentials or private scan reports in public issues. Use GitHub's private reporting form (enabled for this repository):

https://github.com/masahiroid/web-security-hub/security/advisories/new

Include the affected version, OS and Node.js version, a description of impact and minimal reproduction steps with synthetic data. GitHub restricts private reports to the reporter, maintainers and invited collaborators until publication. Never include real customer credentials or unrelated private data.

The maintainer acknowledges reports within 14 days, assesses impact and affected versions, and coordinates disclosure and remediation privately. Confirmed exploitable medium-or-higher vulnerabilities must not remain unfixed for more than 60 days after public disclosure. Critical issues receive immediate priority; restrict or disable an affected optional workflow while a fix is prepared. Release notes identify fixed public vulnerabilities by CVE/GHSA when assigned, affected versions, mitigation and upgrade instructions. Credit reporters with their consent. Unsupported versions should be upgraded to the current source or supported release.

This policy covers this repository's code and its dependency integration. Report upstream defects to their maintainers as well; track mitigation here rather than treating an upstream issue as resolved locally.

## Secure development and cryptography

- Keep the application on loopback. Require explicit target authorization for network verification, bounded scope, cancellation and resource limits. Never interpret source findings as permission to send requests.
- Treat paths, scenarios, source files, responses and archives as untrusted. Validate at boundaries, constrain paths to their owned roots and invoke processes with argument arrays rather than interpolated shell commands.
- Verifier authorization capabilities, local tokens and owned ZAP API keys use Node.js `crypto.randomBytes` / `randomUUID`. Evidence integrity and downloaded tool verification use SHA-256. Node.js/OpenSSL and operating-system trust stores provide cryptographic primitives; the project implements no cryptographic algorithm.
- Use HTTPS with certificate verification for external downloads and HTTPS targets. Plain HTTP is permitted for explicitly selected authorized test targets and loopback fixtures/services; it is not a confidential transport. Never use a fixture as a production identity or authentication service. SHA-1 elsewhere is used for non-security DOM/selector comparison, not authentication, integrity or download verification.
- Login credentials for targets are local secrets in `.env` or local browser state, not a database of external users' passwords. They must remain recoverable for authorized target login; they cannot be replaced by password hashes. Keep them out of Git, logs and report publication. Test-site accounts and deliberately unsafe SAST examples are synthetic fixtures.
- Lint, strict type checks, automated tests and dependency audits gate changes and release builds. Review static-analysis findings and fix confirmed exploitable medium-or-higher issues promptly; do not suppress a finding merely to obtain a badge. See [CONTRIBUTING.md](CONTRIBUTING.md).

## 脆弱性の報告

上記のGitHub非公開報告フォームを使用してください。バージョン・実行環境・影響・架空データでの再現手順を記載し、公開Issueに秘密情報を書かないでください。14日以内に受領を連絡し、重大な問題を優先して対応します。確認された中程度以上の悪用可能な脆弱性を、公開から60日を超えて放置しません。修正版のリリースノートにCVE/GHSA・影響範囲・回避策・更新手順を記載します。報告者名の公開は同意を得て行います。
