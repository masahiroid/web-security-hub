import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VEX_LIMITS, VEX_STORAGE } from '../domain/vexConfig';
import type { OpenVexDocument, VexDraft } from '../domain/vexTypes';
import type { VexStore } from '../application/vexReview';
import { privateDirectory } from './privateDirectory';
import { readPrivateJson } from './privateJson';

const validId = (id: string) => { if (!new RegExp(VEX_STORAGE.uuidPattern).test(id)) throw Error('Invalid draft ID'); };
function asDraft(value: unknown): VexDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Corrupt draft');
  const draft = value as Partial<VexDraft>;
  if (draft.schemaVersion !== VEX_LIMITS.schemaVersion || typeof draft.draftId !== 'string' || !Array.isArray(draft.statements) || !draft.review) throw Error('Corrupt draft');
  validId(draft.draftId);
  return draft as VexDraft;
}
/** Drafts and exports stay private on this machine; an approved export is written once beside its draft. */
export function createVexStore(dataRoot: string): VexStore {
  const root = () => privateDirectory(dataRoot, VEX_STORAGE.segments);
  async function replace(folder: string, name: string, content: string) {
    const pending = await mkdtemp(join(folder, '.pending-'));
    try { await writeFile(join(pending, name), content, { flag: 'wx', mode: VEX_STORAGE.fileMode }); await rename(join(pending, name), join(folder, name)); }
    finally { await rm(pending, { recursive: true, force: true }); }
  }
  async function folderFor(id: string) {
    validId(id);
    return { folder: join(await root(), id) };
  }
  return {
    async save(draft: VexDraft) {
      const json = JSON.stringify(draft);
      if (Buffer.byteLength(json) > VEX_LIMITS.maximumBytes) throw Error('Draft exceeds storage limit');
      const { folder } = await folderFor(draft.draftId);
      await mkdir(folder, { recursive: true, mode: VEX_STORAGE.directoryMode });
      await replace(folder, VEX_STORAGE.draftFile, json);
    },
    async load(id: string) { const { folder } = await folderFor(id); return asDraft(await readPrivateJson(folder, VEX_STORAGE.draftFile, VEX_LIMITS.maximumBytes)); },
    async list() {
      const base = await root();
      const names = (await readdir(base, { withFileTypes: true })).filter(entry => entry.isDirectory() && new RegExp(VEX_STORAGE.uuidPattern).test(entry.name)).map(entry => entry.name);
      const drafts: VexDraft[] = [];
      for (const name of names) { try { drafts.push(asDraft(await readPrivateJson(join(base, name), VEX_STORAGE.draftFile, VEX_LIMITS.maximumBytes))); } catch { /* A damaged draft must not hide the others. */ } }
      return drafts.sort((left, right) => left.createdAt < right.createdAt ? 1 : -1).slice(0, VEX_LIMITS.draftsRetained);
    },
    async saveExport(id: string, document: OpenVexDocument) {
      const { folder } = await folderFor(id);
      await replace(folder, VEX_STORAGE.exportFile, `${JSON.stringify(document, null, 2)}\n`);
      return join(folder, VEX_STORAGE.exportFile);
    },
  };
}
