import { chmod, lstat, mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { ZAP } from '../domain/zap';

export async function privateDirectory(dataRoot: string, segments: readonly string[]): Promise<string> {
  await mkdir(dataRoot, { recursive: true, mode: ZAP.directoryMode }); let current = await realpath(dataRoot);
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || /[\\/]/.test(segment)) throw Error('Invalid private directory');
    current = join(current, segment);
    try { await mkdir(current, { mode: ZAP.directoryMode }); }
    catch (error: unknown) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error; }
    const stat = await lstat(current); if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Unsafe private directory');
  }
  await chmod(current, ZAP.directoryMode); return current;
}
