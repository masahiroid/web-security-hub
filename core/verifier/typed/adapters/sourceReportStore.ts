import { assertNotLinked } from './linkGuard';
import { constants } from 'node:fs';
import { lstat, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPORT_STORAGE } from '../domain/campaignConfig';
import { validate } from '../../contracts';
import { privateDirectory } from './privateDirectory';
import { renderSourceReport } from './sourceReportHtml';

export function createSourceReportStore(dataRoot: string) {
  const directory = () => privateDirectory(dataRoot, ['artifacts', 'private', 'source-verifier']);
  const validId = (id: string) => { if (!new RegExp(REPORT_STORAGE.uuidPattern).test(id)) throw Error('Invalid source report ID'); };
  return {
    async save(input: unknown) {
      const report = validate('sourceReport', input); validId(report.reportId); const root = await directory();
      const destination = join(root, report.reportId);
      try { await lstat(destination); throw Error('Source report exists'); }
      catch (error: unknown) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
      const pending = await mkdtemp(join(root, REPORT_STORAGE.pendingPrefix));
      try {
        await writeFile(join(pending, REPORT_STORAGE.jsonName), JSON.stringify(report), { flag: 'wx', mode: REPORT_STORAGE.fileMode });
        await writeFile(join(pending, REPORT_STORAGE.htmlName), renderSourceReport(report), { flag: 'wx', mode: REPORT_STORAGE.fileMode });
        await rename(pending, destination);
      } finally { await rm(pending, { recursive: true, force: true }); }
      return { jsonFile: join(destination, REPORT_STORAGE.jsonName), htmlFile: join(destination, REPORT_STORAGE.htmlName) };
    },
    async read(id: string) {
      validId(id); const folder = join(await directory(), id);
      const stat = await lstat(folder); if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid report directory');
      const jsonFile = join(folder, REPORT_STORAGE.jsonName);
      const file = await open(jsonFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch((cause: unknown) => { throw new Error('Unsafe source report file', { cause }); });
      try {
        await assertNotLinked(jsonFile, 'Unsafe source report file');
        const info = await file.stat(); if (!info.isFile() || info.size > REPORT_STORAGE.maximumBytes) throw Error('Invalid report file');
        const report = validate('sourceReport', await file.readFile('utf8')); if (report.reportId !== id) throw Error('Report ID mismatch'); return report;
      } finally { await file.close(); }
    }
  };
}
