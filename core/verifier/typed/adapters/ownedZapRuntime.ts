import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ZAP, type ZapPort } from '../domain/zap';
import { createZapApi } from './zapApi';
import { createZapEvidence } from './zapEvidence';
import { privateDirectory } from './privateDirectory';
import { readZapInstallation, type ZapInstallation } from './zapRuntimeInstall';
const execute = promisify(execFile);

async function availablePort(): Promise<number> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, ZAP.host, resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw Error('No ZAP port'); return address.port;
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
export interface OwnedZap { readonly port: ZapPort; close(): Promise<void> }
/** Only this process and freshly created private home/session are ever terminated/deleted. */
export async function startOwnedZap(dataRoot: string, signal: AbortSignal, installation?: ZapInstallation): Promise<OwnedZap> {
  const runtime = installation ?? await readZapInstallation(dataRoot); if (!runtime) throw Error('ZAP runtime not installed');
  signal.throwIfAborted();
  const parent = await privateDirectory(dataRoot, ['artifacts', 'private', 'zap']);
  const home = await mkdtemp(join(parent, 'session-'));
  try { return await launchOwnedZap(home, runtime, signal); }
  catch (error: unknown) { await rm(home, { recursive: true, force: true, maxRetries: ZAP.cleanupRetries, retryDelay: ZAP.pollMs }); throw error; }
}
async function launchOwnedZap(home: string, runtime: ZapInstallation, signal: AbortSignal): Promise<OwnedZap> {
  await chmod(home, ZAP.directoryMode);
  const key = randomBytes(ZAP.keyBytes).toString('hex'); const port = await availablePort();
  const config = join(home, 'private.properties');
  await writeFile(config, `api.key=${key}\napi.disablekey=false\napi.nokeyforsafeops=false\napi.autofillkey=false\napi.addrs.addr.name=${ZAP.host}\napi.addrs.addr.regex=false\n`, { mode: ZAP.fileMode, flag: 'wx' });
  const child = spawn(process.execPath, [join(__dirname, 'zapGuardian.js'), runtime.java, runtime.jar, home, config, String(port)],
    { windowsHide: true, detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
  let exited = false; let spawnFailed = false;
  const exit = new Promise<void>(resolve => { child.once('exit', () => { exited = true; resolve(); }); child.once('error', () => { spawnFailed = true; exited = true; resolve(); }); });
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async () => {
      signal.removeEventListener('abort', cancel);
      if (!exited) child.stdin?.end();
      await Promise.race([exit, delay(ZAP.shutdownMs + ZAP.pollMs, undefined, { ref: false })]);
      if (!exited && child.pid) {
        if (process.platform === 'win32') await execute('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
        else { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* It already exited. */ } }
        await exit;
      }
      await rm(home, { recursive: true, force: true, maxRetries: ZAP.cleanupRetries, retryDelay: ZAP.pollMs });
    })(); return closing;
  }
  const cancel = () => { void close().catch(() => {}); }; signal.addEventListener('abort', cancel, { once: true });
  const api = createZapApi(`http://${ZAP.host}:${port}`, key); const deadline = Date.now() + ZAP.startupMs;
  try {
    while (Date.now() < deadline) {
      signal.throwIfAborted(); if (exited || spawnFailed) throw Error('Owned ZAP exited');
      try {
        const version = await api.get(ZAP.endpoints.version, {}, signal);
        if (version.version !== ZAP.version) throw Error('Unexpected ZAP version');
        const actualSession = (await api.get(ZAP.endpoints.session, {}, signal)).sessionLocation;
        const normalize = (value: string) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
        if (typeof actualSession !== 'string' || ![join(home, 'owned-session'), join(home, 'owned-session.session')].some(path => normalize(path) === normalize(actualSession))) throw Error('Foreign ZAP session');
        signal.throwIfAborted(); if (exited) throw Error('Owned ZAP exited');
        return { port: createZapEvidence(api, `http://${ZAP.host}:${port}`, randomUUID()), close };
      } catch { await delay(ZAP.pollMs, undefined, { signal }); }
    }
    throw Error('Owned ZAP startup deadline');
  } catch (error: unknown) { await close(); throw error; }
}
