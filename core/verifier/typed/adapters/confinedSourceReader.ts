import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { LIMITS } from '../domain/config';
import { SAST_MAPPING } from '../domain/sastMapping';
import { SourceBindingError, type SourceReader } from '../domain/sourceBinding';

const DENIED_SEGMENTS = new Set(['.git', 'node_modules', 'artifacts', 'internal', '.internal']);
/** Trusted backend roots only. No source is imported, evaluated or returned as text. */
export async function createConfinedSourceReader(roots: Readonly<Record<string, string>>): Promise<SourceReader> {
  const catalog = new Map<string, string>();
  for (const [id, root] of Object.entries(roots)) {
    const canonical = await realpath(root);
    if (!(await lstat(canonical)).isDirectory()) throw new SourceBindingError();
    catalog.set(id, canonical);
  }
  return { async read(rootId, path, signal) {
    signal.throwIfAborted();
    const root = catalog.get(rootId);
    const parts = path.split('/');
    if (!root || !path || path.length > SAST_MAPPING.maximumRelativePathLength || isAbsolute(path) ||
        path.includes('\\') || path.includes(':') || path.includes('\0') ||
        parts.some(part => !part || part === '.' || part === '..' || DENIED_SEGMENTS.has(part) || part.startsWith('.env')) ||
        !SAST_MAPPING.javascriptExtensions.some(extension => path.endsWith(extension))) throw new SourceBindingError();
    const authorizedRoot = root;
    const file = resolve(authorizedRoot, ...parts);
    async function checkPath() {
      let current = authorizedRoot;
      for (const part of parts) {
        signal.throwIfAborted(); current = join(current, part);
        if ((await lstat(current)).isSymbolicLink()) throw new SourceBindingError();
      }
      const canonical = await realpath(file); const rel = relative(authorizedRoot, canonical);
      if (canonical !== file || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new SourceBindingError();
      return lstat(file, { bigint: true });
    }
    const before = await checkPath();
    if (!before.isFile() || before.size > BigInt(LIMITS.sourceFileBytes)) throw new SourceBindingError();
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new SourceBindingError();
      const bytes = Buffer.alloc(Number(opened.size)); let offset = 0;
      while (offset < bytes.length) {
        signal.throwIfAborted();
        const result = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!result.bytesRead) throw new SourceBindingError();
        offset += result.bytesRead;
      }
      signal.throwIfAborted();
      const after = await handle.stat({ bigint: true }); const current = await checkPath();
      if ([after, current].some(stat => stat.dev !== opened.dev || stat.ino !== opened.ino ||
          stat.size !== opened.size || stat.mtimeNs !== opened.mtimeNs || stat.ctimeNs !== opened.ctimeNs)) throw new SourceBindingError();
      return bytes;
    } finally { await handle.close(); }
  } };
}
