# Desktop application and double-click startup

[日本語](README.ja.md)

## Start

Open the packaged macOS `.app`. Node.js is included. The start screen checks writable storage and the automation browser. Select **Install required browser** if needed; its initial download requires internet access.

For source distributions, double-click `start.command` on macOS or `start.bat` on Windows. On Linux, run executable `start.sh`; whether a double-click runs it depends on the file manager's executable-file settings.

The source launcher checks Node.js 22+ and npm. If absent, it downloads the pinned official runtime, verifies the committed SHA-256 and installs it under `.runtime/`. Locked dependencies are prepared automatically. It requires no administrator privileges and does not replace global Node.js. Initial progress/errors appear in a terminal; browser installation appears on the start screen. The Windows PowerShell execution-policy option applies only to that launcher process, not system policy.

Use the **Desktop app guide** on Home for command-free exercises. The in-app illustrated course also replaces startup, mode switches and reset commands with buttons. **Start hands-on environment** prepares bilingual training sites. Buttons switch Baseline / Changed / Fixed modes and reset state. SAST fixture links open the analysis screen with source paths already filled in.

![Desktop start screen](../../desktop/welcome/images/welcome-en.png)

## CLI remains available

```sh
npm run doctor        # JSON checks; exits 1 if setup is incomplete
npm run setup         # Install Chromium, then check again
npm run launch        # Start with the setup/home screen
npm start             # Original server on port 4173
```

Existing scanning, generation, replay and training commands remain available. `npm start` retains repository-relative storage.

## Storage and shutdown

Managed startup stores sites, credentials and results in writable user data. Native and source launchers use separate default directories; the actual path is displayed on Home. Override with `WEB_SECURITY_HUB_DATA_DIR`.

On macOS, the native app uses `~/Library/Application Support/io.github.masahirocom.web-security-hub/`; the source launcher uses `~/Library/Application Support/Web Security Hub/`. Other platforms use their user-data directories (Tauri's app data directory for native builds).

Existing repository data is not moved automatically. Stop servers before copying your `sites/` tree, including `.env` files, to the new data location. Recheck existing visual baselines when changing OS/browser.

Quitting the native app terminates its internal servers and child-process group/tree. In source mode press Ctrl+C in the launcher terminal. Managed local APIs require a random authenticated session and validate Host/Origin; they bind only to loopback. Scanned pages receive no native shell-command permissions.

## Development and validation

```sh
npm ci --ignore-scripts
npm run desktop:prepare
npm run desktop:dev
npm run desktop:build
npm run desktop:verify
```

Building requires Rust and [Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/). Preparation stages the official Node runtime and production dependency tree. Build each OS/CPU on a matching native CI runner.

`desktop:verify` uses empty temporary user data to exercise missing-browser detection, GUI installation, training startup, static analysis, and generation/edit/baseline/replay outside the source tree. It downloads a browser and requires training port 4180. Evidence is saved under `artifacts/desktop/`.

Windows/Linux build definitions are provided, but those platforms were not tested on this macOS host. Linux may require OS-level browser libraries. ZAP, mobile, AI and alternative browsers need separate setup/validation.

## Package scope

The initial native package includes web automation, scanning and training. Appium/WebdriverIO are not bundled; mobile remains available in the source/CLI edition. Distribution dependencies are locked independently in `desktop/runtime/package{,-lock}.json`. The full source mobile dependency tree still has audit findings requiring separate remediation.

3.0.0: optional managed ZAP setup is available in the Static Analysis workspace. See the [source verification guide](../training/SAST-MAPPING.md). This is independent of the older dynamic-scan ZAP configuration. Windows installer acceptance runs in a Windows CI host; Linux native installation remains unverified.
