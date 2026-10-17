'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
function defaultDataDir() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Application Support/Web Security Hub');
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'Web Security Hub');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'web-security-hub');
}
async function inspectEnvironment() {
  const { chromium } = require('playwright');
  const checks = [{ id: 'node', ok: Number(process.versions.node.split('.')[0]) >= 22, detail: process.version }];
  const dataDir = process.env.WEB_SECURITY_HUB_DATA_DIR || defaultDataDir();
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const probe = path.join(dataDir, `.write-check-${process.pid}`); fs.writeFileSync(probe, 'ok', { flag: 'wx' }); fs.unlinkSync(probe);
    checks.push({ id: 'storage', ok: true, detail: dataDir });
  } catch (e) { checks.push({ id: 'storage', ok: false, detail: e.message }); }
  // Launching checks both browser installation and host library availability.
  try { const browser = await chromium.launch({ headless: true, timeout: 15000 }); await browser.close(); checks.push({ id: 'chromium', ok: true, detail: chromium.executablePath() }); }
  catch (e) { checks.push({ id: 'chromium', ok: false, reason: /Executable doesn't exist/.test(e.message) ? 'notInstalled' : 'cannotLaunch', detail: e.message.slice(0, 3000) }); }
  return { packaged: process.env.WEB_SECURITY_HUB_PACKAGED === '1', ready: checks.every(c => c.ok), checks, dataDir, platform: process.platform, arch: process.arch, version: require('../package.json').version };
}
function installBrowser(log = () => {}) {
  const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  return new Promise((resolve, reject) => {
    // Do not install system packages or request elevation. Linux prerequisites are documented.
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], { env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', b => log(b.toString()));
    child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`Browser installation failed (${code}). Check the log and retry.`)));
  });
}
if (require.main === module) {
  (async () => {
    if (process.argv.includes('--install')) await installBrowser(s => process.stdout.write(s));
    const result = await inspectEnvironment(); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ready ? 0 : 1;
  })().catch(e => { console.error(e.message); process.exitCode = 1; });
}
module.exports = { defaultDataDir, inspectEnvironment, installBrowser };
