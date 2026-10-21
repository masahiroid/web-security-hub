import { lstat, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GeneticCampaignReport } from '../domain/geneticCampaignTypes';
import type { ComparisonReport } from '../domain/geneticComparisonTypes';
import { GENETIC_FIXTURE } from '../domain/geneticFixtureConfig';
import { REPORT_STORAGE } from '../domain/campaignConfig';
import { privateDirectory } from './privateDirectory';
const escaped = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** Exact synthetic inputs are retained only in private JSON and a script-free escaped HTML view. */
export function createGeneticReportStore(dataRoot: string) {
  async function write(directory: readonly string[], id: string, record: object) {
      if (!new RegExp(REPORT_STORAGE.uuidPattern).test(id)) throw Error('Invalid genetic report ID');
      const json = JSON.stringify(record);
      if (Buffer.byteLength(json) > REPORT_STORAGE.maximumBytes) throw Error('Genetic report exceeds storage limit');
      const root = await privateDirectory(dataRoot, directory);
      const destination = join(root, id);
      try { await lstat(destination); throw Error('Genetic report already exists'); }
      catch (error: unknown) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
      const pending = await mkdtemp(join(root, REPORT_STORAGE.pendingPrefix));
      try {
        const options = { flag: 'wx', mode: REPORT_STORAGE.fileMode };
        await writeFile(join(pending, REPORT_STORAGE.jsonName), json, options);
        await writeFile(join(pending, REPORT_STORAGE.htmlName), `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><title>Private genetic verification / 非公開GA検証</title><h1>Private genetic verification / 非公開GA検証</h1><p>Semantic sample points only; general code coverage is not measured. / 専用サンプルの意味的な計測点のみ。一般コードのカバレッジは未計測。</p><pre>${escaped(json)}</pre>`, options);
        await rename(pending, destination);
      } catch (error: unknown) { await rm(pending, { force: true, recursive: true }); throw error; }
      return Object.freeze({ reportId: id, jsonFile: join(destination, REPORT_STORAGE.jsonName), htmlFile: join(destination, REPORT_STORAGE.htmlName) });
  }
  return {
    save: (report: GeneticCampaignReport) => write(GENETIC_FIXTURE.reportDirectory, report.reportId, report),
    saveComparison: (report: ComparisonReport) => write(GENETIC_FIXTURE.comparisonDirectory, report.comparisonId, report),
  };
}
