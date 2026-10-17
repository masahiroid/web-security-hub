'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
process.env.PATH = path.join(require('os').homedir(), '.cargo/bin') + path.delimiter + process.env.PATH;
const root = path.resolve(__dirname, '..');
const verifierSourceDirectory = path.join(root, 'core/verifier/typed');
function publicResource(file) {
  if (file === verifierSourceDirectory || file.startsWith(verifierSourceDirectory + path.sep)) return false;
  const name=path.basename(file);
  if(/(?:^|[\\/])(?:internal|\.internal)(?:[\\/]|$)/.test(file)||/\.internal\.(?:md|html)$/.test(name))return false;
  return !['.git','.DS_Store','node_modules','.runtime'].includes(name)
    && !(name==='.env'||(name.startsWith('.env.')&&name!=='.env.example'))
    && !/\.(?:p12|pfx|p8|key|pem|keychain|keychain-db|mobileprovision|provisionprofile)$/i.test(name);
}
const runtime = require('../desktop/node-runtime.json');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio:'inherit',...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
async function main() {
  require('./desktop-config').ensureDesktopConfig();
  // Compile the incremental TypeScript modules before copying production resources.
  run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(root, 'tsconfig.verifier.json')]);
  const host = spawnSync('rustc', ['--print','host-tuple'], { encoding:'utf8' });
  if (host.status !== 0) throw new Error('Install Rust and the Tauri platform prerequisites before building the desktop app.');
  const target = host.stdout.trim();
  const argument = process.argv.indexOf('--target');
  if (argument >= 0 && process.argv[argument + 1] !== target) throw new Error('Prepare each platform on its matching native runner; cross-compiled Node resources are not supported.');
  const platform = process.platform === 'win32' ? 'win' : process.platform;
  const suffix = process.platform === 'win32' ? '.zip' : '.tar.gz';
  const basename = `node-v${runtime.version}-${platform}-${process.arch}`;
  const cache = path.join(root, '.desktop/cache'); fs.mkdirSync(cache,{recursive:true});
  const archive = path.join(cache,basename + suffix);
  const expected = runtime.sha256[`${process.platform}-${process.arch}`];
  if (!expected) throw new Error('Unsupported platform/architecture');
  if (!fs.existsSync(archive)) {
    console.log(`Downloading pinned Node.js ${runtime.version}`);
    const response = await fetch(`https://nodejs.org/dist/v${runtime.version}/${basename}${suffix}`);
    if (!response.ok) throw new Error(`Node download failed: ${response.status}`);
    const partial = archive + '.partial'; fs.writeFileSync(partial,Buffer.from(await response.arrayBuffer())); fs.renameSync(partial,archive);
  }
  if (crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== expected) {
    fs.unlinkSync(archive); throw new Error('Node checksum mismatch; archive removed. Retry the download.');
  }
  if (!fs.existsSync(path.join(cache,basename))) {
    if (process.platform === 'win32') run('powershell.exe',['-NoProfile','-Command','Expand-Archive -LiteralPath $env:WSH_ARCHIVE -DestinationPath $env:WSH_CACHE -Force'], {env:{...process.env,WSH_ARCHIVE:archive,WSH_CACHE:cache}});
    else run('tar',['-xzf',archive,'-C',cache]);
  }
  const node = path.join(cache,basename,process.platform === 'win32' ? 'node.exe' : 'bin/node');
  const binaryDir = path.join(root,'src-tauri/binaries'); fs.mkdirSync(binaryDir,{recursive:true});
  const binary = path.join(binaryDir,`web-security-node-${target}${process.platform === 'win32' ? '.exe' : ''}`);
  fs.copyFileSync(node,binary); if (process.platform !== 'win32') fs.chmodSync(binary,0o755);
  const stage = path.join(root,'.desktop/runtime'); fs.mkdirSync(stage,{recursive:true});
  for (const name of ['core','server','public','training']) {
    fs.rmSync(path.join(stage,name),{recursive:true,force:true});
    fs.cpSync(path.join(root,name),path.join(stage,name),{recursive:true,filter:publicResource});
  }
  // Bundle only runtime entry points and public course material, not release tooling.
  for (const name of ['desktop','docs','scripts']) fs.rmSync(path.join(stage,name),{recursive:true,force:true});
  for (const name of ['desktop/host.js','desktop/environment.js','desktop/courseRenderer.js','desktop/welcome','docs/training','scripts/training.js']) {
    fs.mkdirSync(path.dirname(path.join(stage,name)),{recursive:true});
    fs.cpSync(path.join(root,name),path.join(stage,name),{recursive:true,filter:publicResource});
  }
  for (const name of ['LICENSE','NOTICE']) fs.copyFileSync(path.join(root,name),path.join(stage,name));
  for (const name of ['package.json','package-lock.json']) fs.copyFileSync(path.join(root,'desktop/runtime',name),path.join(stage,name));
  fs.copyFileSync(path.join(cache,basename,'LICENSE'),path.join(stage,'NODE-LICENSE'));
  // Keep a locked production dependency tree separate from developer dependencies.
  const stamp = crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'desktop/runtime/package-lock.json'))).digest('hex');
  const stampPath = path.join(stage,'.dependencies-sha256');
  if (!fs.existsSync(stampPath) || fs.readFileSync(stampPath,'utf8') !== stamp) {
    const npmCli = process.platform === 'win32' ? path.join(cache,basename,'node_modules/npm/bin/npm-cli.js') : path.join(cache,basename,'lib/node_modules/npm/bin/npm-cli.js');
    run(node,[npmCli,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:stage});
    fs.writeFileSync(stampPath,stamp);
  }
  console.log(`Desktop resources ready: ${target}`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
