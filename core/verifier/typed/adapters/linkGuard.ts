import { realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

/**
 * Link check performed after a file has been opened. Platforms without
 * O_NOFOLLOW (Windows) would otherwise follow a link silently, so the opened
 * path must resolve to its own directory plus its own name.
 */
export async function assertNotLinked(file: string, message: string): Promise<void> {
  const absolute = resolve(file);
  const actual = await realpath(absolute);
  const expected = join(await realpath(dirname(absolute)), basename(absolute));
  if (actual !== expected) throw new Error(message);
}

export function assertNotLinkedSync(file: string, message: string): void {
  const absolute = resolve(file);
  const actual = realpathSync(absolute);
  const expected = join(realpathSync(dirname(absolute)), basename(absolute));
  if (actual !== expected) throw new Error(message);
}
