import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asRecord, type SiteStore } from './types';

/** File adapter for reusable step groups (sites/<id>/shared-steps.json) and their expansion. */

/** Shared groups may reference other groups up to this depth (guards against cycles). */
export const MAX_EXPANSION_DEPTH = 5;
const SHARED_STEPS_FILE = 'shared-steps.json';

export interface SharedSteps {
  listSharedSteps(siteId: string): unknown[];
  writeSharedSteps(siteId: string, groups: unknown): void;
  expandSharedSteps(steps: unknown, siteId: string, depth?: number): unknown[];
}

export function createSharedSteps(store: Pick<SiteStore, 'siteDir'>): SharedSteps {
  const file = (siteId: string): string => join(store.siteDir(siteId), SHARED_STEPS_FILE);

  function listSharedSteps(siteId: string): unknown[] {
    const path = file(siteId);
    if (!existsSync(path)) return [];
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('shared-steps.json must contain an array');
    return parsed;
  }

  function expandSharedSteps(steps: unknown, siteId: string, depth = 0): unknown[] {
    if (!Array.isArray(steps)) return [];
    if (depth > MAX_EXPANSION_DEPTH) throw new Error('shared step expansion exceeded max depth (possible cycle)');
    const groups = listSharedSteps(siteId);
    const out: unknown[] = [];
    for (const step of steps as unknown[]) {
      const record = asRecord(step);
      if (record && record['action'] === 'useSharedStep') {
        const group = groups.map(asRecord).find((g) => g?.['name'] === record['name']);
        if (!group) throw new Error(`shared step not found: ${String(record['name'])}`);
        out.push(...expandSharedSteps(group['steps'], siteId, depth + 1));
      } else {
        out.push(step);
      }
    }
    return out;
  }

  return {
    listSharedSteps,
    writeSharedSteps(siteId, groups) {
      if (!Array.isArray(groups)) throw new Error('shared steps must be an array');
      for (const raw of groups as unknown[]) {
        const group = asRecord(raw);
        const name = group?.['name'];
        if (!group || typeof name !== 'string' || !name.trim()) throw new Error('each shared step group requires a name');
        if (!Array.isArray(group['steps'])) throw new Error(`shared step group "${name}" requires a steps array`);
      }
      mkdirSync(store.siteDir(siteId), { recursive: true });
      writeFileSync(file(siteId), JSON.stringify(groups, null, 2) + '\n', 'utf8');
    },
    expandSharedSteps,
  };
}
