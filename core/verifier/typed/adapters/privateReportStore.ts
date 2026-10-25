import { assertNotLinked } from './linkGuard';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPORT_STORAGE } from '../domain/campaignConfig';
import { renderReport } from './reportHtml';
import type { ContractsPort } from '../domain/types';
import type { ReportStore } from '../domain/campaignTypes';
function validId(id: string): void { if (!new RegExp(REPORT_STORAGE.uuidPattern).test(id)) throw Error('Invalid report ID'); }
export function createPrivateReportStore(dataRoot: string, contracts: ContractsPort): ReportStore {
  async function directory() {
    await mkdir(dataRoot, { recursive: true, mode: REPORT_STORAGE.directoryMode });
    let current = await realpath(dataRoot);
    for (const segment of REPORT_STORAGE.segments) {
      current = join(current, segment);
      try { await mkdir(current, { mode: REPORT_STORAGE.directoryMode }); }
      catch (error: unknown) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error; }
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Unsafe report directory');
    }
    await chmod(current, REPORT_STORAGE.directoryMode);
    return current;
  }
  return {
    async save(input) {
      const report = contracts.validate('report', input); validId(report.reportId);
      const json = JSON.stringify(report, null, 2);
      if (Buffer.byteLength(json) > REPORT_STORAGE.maximumBytes) throw Error('Report file exceeds limit');
      const root = await directory(); const destination = join(root, report.reportId);
      try { await lstat(destination); throw Error('Report already exists'); }
      catch (error: unknown) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
      const pending = await mkdtemp(join(root, REPORT_STORAGE.pendingPrefix));
      try {
        const options = { flag: 'wx', mode: REPORT_STORAGE.fileMode };
        await writeFile(join(pending, REPORT_STORAGE.jsonName), json, options);
        await writeFile(join(pending, REPORT_STORAGE.htmlName), renderReport(report), options);
        await rename(pending, destination);
      } catch (error: unknown) { await rm(pending, { recursive: true, force: true }); throw error; }
      return Object.freeze({ reportId: report.reportId, jsonFile: join(destination, REPORT_STORAGE.jsonName), htmlFile: join(destination, REPORT_STORAGE.htmlName) });
    },
    async read(reportId) {
      validId(reportId);
      const root = await directory(); const folder = join(root, reportId);
      const stat = await lstat(folder);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Unsafe report directory');
      const jsonPath = join(folder, REPORT_STORAGE.jsonName);
      const file = await open(jsonPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch((cause: unknown) => { throw new Error('Unsafe report file', { cause }); });
      try {
        await assertNotLinked(jsonPath, 'Unsafe report file');
        const info = await file.stat();
        if (!info.isFile() || info.size > REPORT_STORAGE.maximumBytes) throw Error('Invalid report file');
        const report = contracts.validate('report', await file.readFile('utf8'));
        if (report.reportId !== reportId) throw Error('Report ID mismatch');
        return report;
      } finally { await file.close(); }
    }
  };
}
