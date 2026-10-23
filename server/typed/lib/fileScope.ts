import fs from 'node:fs';
import path from 'node:path';

/** The absolute path of `relative` under `base`, or undefined when it would escape the base directory. */
export function resolveInside(base: string, relative: string): string | undefined {
  const target = path.normalize(path.join(base, relative));
  return target.startsWith(`${path.normalize(base)}${path.sep}`) ? target : undefined;
}
export const existsAt = (target: string): boolean => fs.existsSync(target);
