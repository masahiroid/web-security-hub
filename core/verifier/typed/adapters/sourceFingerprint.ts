import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { DIGEST_ALGORITHM } from '../domain/config';
export interface SourceFile { readonly name: string; readonly file: string }
function fingerprint(parts: readonly { readonly name: string; readonly bytes: Uint8Array }[]): string {
  const hash = createHash(DIGEST_ALGORITHM);
  for (const part of [...parts].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    // JSON tuples delimit both name and length; neither can ambiguously join bytes.
    hash.update(JSON.stringify([part.name, part.bytes.byteLength])); hash.update(part.bytes);
  }
  return hash.digest('hex');
}
export function sourceFingerprintSync(files: readonly SourceFile[]): string {
  return fingerprint(files.map(({ name, file }) => ({ name, bytes: readFileSync(file) })));
}
export async function sourceFingerprint(files: readonly SourceFile[], signal?: AbortSignal): Promise<string> {
  return fingerprint(await Promise.all(files.map(async ({ name, file }) => ({ name, bytes: await readFile(file, signal ? { signal } : {}) }))));
}
