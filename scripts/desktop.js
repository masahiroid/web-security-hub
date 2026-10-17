'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname,'..');
// Avoid embedding the maintainer's home/workspace paths in shipped Rust binaries.
if (process.env.RUSTFLAGS && !process.env.CARGO_ENCODED_RUSTFLAGS) {
  console.error('Use CARGO_ENCODED_RUSTFLAGS instead of RUSTFLAGS so release path remapping can preserve custom flags.');
  process.exit(1);
}
const remaps=[`--remap-path-prefix=${require('os').homedir()}=/build/home`,`--remap-path-prefix=${root}=/build/web-security-hub`];
process.env.CARGO_ENCODED_RUSTFLAGS=[process.env.CARGO_ENCODED_RUSTFLAGS,...remaps].filter(Boolean).join('\x1f');
process.env.PATH = path.join(require('os').homedir(),'.cargo/bin') + path.delimiter + process.env.PATH;
for (const args of [[path.join(__dirname,'prepare-desktop.js')], [path.join(path.dirname(require.resolve('@tauri-apps/cli/package.json')),'tauri.js'), ...process.argv.slice(2)]]) {
  const result = spawnSync(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit'});
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
