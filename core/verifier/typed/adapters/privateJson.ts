import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';

/** Reads one regular, size-bounded JSON file inside an already verified private folder. */
export async function readPrivateJson(folder: string, name: string, maximumBytes: number): Promise<unknown> {
  const folderInfo = await lstat(folder);
  if (folderInfo.isSymbolicLink() || !folderInfo.isDirectory()) throw Error('Unsafe private folder');
  // Open first (refusing symlinks where the platform supports it), then judge the handle itself, so the checked file is the one read.
  const file = await open(join(folder, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximumBytes) throw Error('Unsafe private file');
    return JSON.parse(await file.readFile({ encoding: 'utf8' })) as unknown;
  } finally { await file.close(); }
}
