#!/usr/bin/env bash
# Source-distribution launcher: private runtime only; no sudo or global PATH changes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PLATFORM="$(uname -s)"
case "$PLATFORM" in Darwin) PLATFORM=darwin ;; Linux) PLATFORM=linux ;; *) echo 'Use start.bat on Windows.'; exit 1 ;; esac
case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) echo 'Unsupported CPU architecture'; exit 1 ;; esac
VERSION="$(awk -F '"' '$2=="version" {print $4;exit}' desktop/node-runtime.json)"
EXPECTED="$(awk -F '"' -v key="$PLATFORM-$ARCH" '$2==key {print $4;exit}' desktop/node-runtime.json)"
PRIVATE="$ROOT/.runtime/node-v$VERSION-$PLATFORM-$ARCH"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE="$(command -v node || true)"
if [ "${WSH_FORCE_PRIVATE_NODE:-0}" = "1" ] || [ -z "$NODE" ] || ! "$NODE" -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>24||(major===24&&minor>=0)?0:1)' || ! command -v npm >/dev/null 2>&1; then
  if [ ! -x "$PRIVATE/bin/node" ]; then
    echo "Preparing private Node.js $VERSION / 専用 Node.js を準備しています…"
    mkdir -p "$ROOT/.runtime"
    ARCHIVE="$(mktemp "$ROOT/.runtime/node-download.XXXXXX")"
    trap 'rm -f "$ARCHIVE"' EXIT
    curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v$VERSION/node-v$VERSION-$PLATFORM-$ARCH.tar.gz" -o "$ARCHIVE"
    if command -v shasum >/dev/null 2>&1; then ACTUAL="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"; else ACTUAL="$(sha256sum "$ARCHIVE" | awk '{print $1}')"; fi
    if [ "$ACTUAL" != "$EXPECTED" ]; then echo 'Checksum mismatch; refusing installation. / 検証に失敗しました。'; exit 1; fi
    tar -xzf "$ARCHIVE" -C "$ROOT/.runtime"
    rm -f "$ARCHIVE"; trap - EXIT
  fi
  export PATH="$PRIVATE/bin:$PATH"
  NODE="$PRIVATE/bin/node"
fi
mkdir -p "$ROOT/.runtime"
LOCK_HASH="$("$NODE" -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync("package-lock.json")).digest("hex"))')"
if [ ! -d node_modules ] || [ ! -f .runtime/dependencies.sha256 ] || [ "$(cat .runtime/dependencies.sha256)" != "$LOCK_HASH" ]; then
  echo 'Installing locked dependencies / 必要な構成をインストールしています…'
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --ignore-scripts --no-audit --no-fund
  printf '%s' "$LOCK_HASH" > .runtime/dependencies.sha256
fi
if [ "${1:-}" = "--doctor" ]; then exec "$NODE" desktop/environment.js; fi
"$NODE" node_modules/typescript/bin/tsc -p tsconfig.verifier.json
"$NODE" node_modules/typescript/bin/tsc -p tsconfig.verifier-ui.json
exec "$NODE" scripts/launch.js "$@"
