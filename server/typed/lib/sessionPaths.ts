import fs from 'node:fs';
import path from 'node:path';
import { readSiteConfig, siteDir } from '../../../core/siteConfig';
import { DEFAULTS, PATTERNS } from '../config';

/** A site's `.golden-master` output directory, shared by every route that reads or writes sessions. */
export function sessionsDir(siteId: string): string {
  const config = readSiteConfig(siteId);
  return path.resolve(siteDir(siteId), typeof config.outputDir === 'string' && config.outputDir ? config.outputDir : DEFAULTS.sessionsDirectory);
}
/** A site's exploration output, a sibling of its test sessions. */
export function exploreSessionsDir(siteId: string): string {
  return path.resolve(sessionsDir(siteId), '..', DEFAULTS.exploreSessionsDirectory);
}
/** Resolves and validates one session's directory, requiring the generated test code to exist there. */
export function sessionDirFor(siteId: string, sessionId: string): string {
  if (!PATTERNS.sessionId.test(sessionId)) throw new Error(`invalid session id: ${sessionId}`);
  const directory = path.join(sessionsDir(siteId), sessionId);
  if (!fs.existsSync(path.join(directory, DEFAULTS.generatedSpec))) throw new Error(`no ${DEFAULTS.generatedSpec} in session: ${sessionId}`);
  return directory;
}
/** Sub-directory names of a directory, newest name first; empty when it does not exist. */
export function listSessionNames(directory: string): string[] {
  return fs.existsSync(directory)
    ? fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse()
    : [];
}
