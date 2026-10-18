import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { privateDirectory } from './privateDirectory';
import { ZAP } from '../domain/zap';
import { ZAP_RUNTIME, ZAP_RUNTIME_VERSION } from '../domain/zapRuntimeConfig';

const execute = promisify(execFile);
interface Artifact { readonly url: string; readonly name: string; readonly sha256: string; readonly bytes: number }
export interface ZapInstallation { readonly java: string; readonly jar: string; readonly home: string }
interface Receipt { readonly version: string; readonly platform: string; readonly arch: string; readonly java: string; readonly jar: string; readonly javaHash: string; readonly jarHash: string }
export function zapRuntimeRoot(dataRoot: string): string { return join(dataRoot, '.runtime', ZAP_RUNTIME_VERSION); }
async function digest(file: string): Promise<string> {
  const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex');
}
function javaAsset(): Artifact {
  const key = `${process.platform}-${process.arch}`;
  if (!Object.hasOwn(ZAP_RUNTIME.java, key)) throw Error('Unsupported ZAP runtime platform');
  return ZAP_RUNTIME.java[key as keyof typeof ZAP_RUNTIME.java];
}
export async function readZapInstallation(dataRoot: string): Promise<ZapInstallation | null> {
  const home = zapRuntimeRoot(dataRoot);
  try {
    for (const directory of [join(dataRoot, '.runtime'), home]) { const stat = await lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) return null; }
    const receiptFile = join(home, 'installed.json'); const receiptInfo = await lstat(receiptFile);
    if (!receiptInfo.isFile() || receiptInfo.isSymbolicLink() || receiptInfo.size > ZAP.apiBytes) return null;
    const raw: unknown = JSON.parse(await readFile(receiptFile, 'utf8'));
    if (!raw || typeof raw !== 'object' || !('version' in raw) || raw.version !== ZAP_RUNTIME_VERSION) return null;
    const receipt = raw as Receipt;
    if (receipt.platform !== process.platform || receipt.arch !== process.arch) return null;
    for (const key of ['java', 'jar'] as const) {
      const path = receipt[key]; if (typeof path !== 'string' || !path || path.split(/[\\/]/).some(part => part === '..') || /^[\\/]|^[A-Za-z]:/.test(path)) return null;
      let current = home;
      for (const part of path.split(/[\\/]/)) { current = join(current, part); if ((await lstat(current)).isSymbolicLink()) return null; }
      const file = join(home, path); const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > ZAP.maximumArchiveBytes || await digest(file) !== receipt[key === 'java' ? 'javaHash' : 'jarHash']) return null;
    }
    return { home, java: join(home, receipt.java), jar: join(home, receipt.jar) };
  } catch { return null; }
}
async function download(asset: Artifact, file: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(asset.url, { signal });
  if (!response.ok || !response.body || asset.bytes > ZAP.maximumArchiveBytes) throw Error('Runtime download failed');
  const reader = response.body.getReader(); const handle = await open(file, 'wx', ZAP.fileMode); const hash = createHash('sha256'); let total = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; signal.throwIfAborted();
      total += part.value.byteLength; if (total > asset.bytes) throw Error('Runtime download exceeds size');
      hash.update(part.value); await handle.writeFile(part.value); }
    if (total !== asset.bytes || hash.digest('hex') !== asset.sha256) throw Error('Runtime checksum mismatch');
  } finally { await reader.cancel().catch(() => {}); await handle.close(); }
}
async function extract(archive: string, destination: string, signal: AbortSignal): Promise<void> {
  if (archive.endsWith('.tar.gz')) await execute('tar', ['-xzf', archive, '-C', destination], { signal, timeout: ZAP.downloadMs });
  else if (process.platform === 'win32') await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:WSH_RUNTIME_ARCHIVE -DestinationPath $env:WSH_RUNTIME_STAGE -Force'],
    { signal, timeout: ZAP.downloadMs, windowsHide: true, env: { ...process.env, WSH_RUNTIME_ARCHIVE: archive, WSH_RUNTIME_STAGE: destination } });
  else await execute('unzip', ['-q', archive, '-d', destination], { signal, timeout: ZAP.downloadMs });
}
async function locateJava(root: string): Promise<string> {
  const folders = await readdir(root, { withFileTypes: true });
  for (const folder of folders) if (folder.isDirectory() && folder.name.startsWith('jdk-')) {
    const parts = process.platform === 'darwin' ? ['Contents', 'Home', 'bin', 'java'] : ['bin', 'java.exe'];
    const file = join(root, folder.name, ...parts); if ((await lstat(file)).isFile()) return file;
  }
  throw Error('Runtime Java executable missing');
}
const installing = new Map<string, Promise<ZapInstallation>>();
export function installZapRuntime(dataRoot: string, signal: AbortSignal): Promise<ZapInstallation> {
  const existing = installing.get(dataRoot); if (existing) return existing;
  const operation = install(dataRoot, signal).finally(() => installing.delete(dataRoot)); installing.set(dataRoot, operation); return operation;
}
async function install(dataRoot: string, parentSignal: AbortSignal): Promise<ZapInstallation> {
  const ready = await readZapInstallation(dataRoot); if (ready) return ready;
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(ZAP.downloadMs)]); signal.throwIfAborted();
  const asset = javaAsset(); const parent = await privateDirectory(dataRoot, ['.runtime']);
  const stage = await mkdtemp(join(parent, '.zap-install-')); await chmod(stage, ZAP.directoryMode);
  try {
    const zapFile = join(stage, ZAP_RUNTIME.zap.name); const javaFile = join(stage, asset.name);
    await download(ZAP_RUNTIME.zap, zapFile, signal); await download(asset, javaFile, signal);
    await extract(zapFile, stage, signal); await extract(javaFile, stage, signal);
    const java = await locateJava(stage); const jar = join(stage, `ZAP_${ZAP.version}`, `zap-${ZAP.version}.jar`);
    await execute(java, ['-version'], { signal, timeout: ZAP.apiTimeoutMs, windowsHide: true });
    const receipt: Receipt = { version: ZAP_RUNTIME_VERSION, platform: process.platform, arch: process.arch, java: relative(stage, java), jar: relative(stage, jar), javaHash: await digest(java), jarHash: await digest(jar) };
    await writeFile(join(stage, 'installed.json'), JSON.stringify(receipt), { mode: ZAP.fileMode, flag: 'wx' });
    await rm(zapFile); await rm(javaFile); signal.throwIfAborted();
    const destination = zapRuntimeRoot(dataRoot);
    // Preserve a broken installation for inspection instead of replacing a live tree.
    try { await lstat(destination); await rename(destination, destination + '.invalid-' + randomUUID()); }
    catch (error: unknown) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
    await rename(stage, destination);
    const result = await readZapInstallation(dataRoot); if (!result) throw Error('Runtime validation failed'); return result;
  } finally { await rm(stage, { recursive: true, force: true }); }
}
