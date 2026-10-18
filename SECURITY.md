# Security and dependency scope

Use only targets you own or are explicitly authorized to test. Source analysis never grants permission to send requests. Source-verification results remain under investigation without runtime instrumentation and an independent oracle.

The desktop runtime manifest is intentionally separate from the source automation toolkit. Appium, its iOS driver and WebdriverIO are not bundled in desktop installers. Optional managed ZAP/Java are downloaded only on request, from pinned official releases with size/SHA-256 verification. Private reports and local signing configuration are excluded from Git and release bundles.

For 3.0.0, `npm audit --omit=dev --prefix desktop/runtime` reports no known vulnerabilities. The source toolkit still reports high-severity advisories in `extract-zip@2.0.1` through `@puppeteer/browsers` / WebdriverIO; the upstream package has no patched published version at the release review. Do not use that optional browser-downloader path with untrusted archives. This does not affect the separate desktop runtime or the managed ZAP installer, which use neither package. Patched `shell-quote` and `basic-ftp` are pinned with overrides; retain those overrides until upstream dependency ranges include the fixes. Mobile hardware automation is not part of the desktop acceptance tests.

References: [extract-zip symlink traversal](https://github.com/advisories/GHSA-jmr9-qjv8-65gv), [extract-zip directory traversal](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3).

日本語：対象への明示許可を得て実施してください。静的解析は送信許可になりません。配布アプリのruntime監査は既知脆弱性0件ですが、ソース版の追加自動化toolkitには上記extract-zip advisoryが残っています。未信頼archiveを追加browser-downloaderへ渡さないでください。デスクトップruntimeとZAP導入はその依存を使いません。内部資料・private結果・実署名設定は公開対象外です。
