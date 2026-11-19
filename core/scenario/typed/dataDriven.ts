import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parseCsv, serializeCsv, type CsvRow } from './csv';
import type { SiteStore } from './types';

/** File adapter for per-site data sets (sites/<id>/data/<name>.csv) used in data-driven runs. */

const DATA_SET_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const DATA_DIR_NAME = 'data';
const CSV_EXTENSION = '.csv';

export interface DataSets {
  listDataSets(siteId: string): string[];
  readDataSet(siteId: string, name: string): CsvRow[];
  writeDataSet(siteId: string, name: string, rows: unknown): void;
  /** One variable-override map per row, for repeating one scenario with different data. */
  buildVariableOverridesPerRow(siteId: string, dataSetName: string): CsvRow[];
}

export function createDataSets(store: Pick<SiteStore, 'siteDir'>): DataSets {
  const dataDir = (siteId: string): string => join(store.siteDir(siteId), DATA_DIR_NAME);

  function dataFile(siteId: string, name: string): string {
    if (!DATA_SET_NAME_RE.test(name)) throw new Error(`invalid data set name: ${name}`);
    // The file must stay inside the site's data directory, whatever the name contains.
    const directory = resolve(dataDir(siteId));
    const file = resolve(directory, `${name}${CSV_EXTENSION}`);
    if (!file.startsWith(`${directory}${sep}`)) throw new Error(`invalid data set name: ${name}`);
    return file;
  }

  function readDataSet(siteId: string, name: string): CsvRow[] {
    const file = dataFile(siteId, name);
    if (!existsSync(file)) throw new Error(`data set not found: ${name}`);
    return parseCsv(readFileSync(file, 'utf8'));
  }

  return {
    listDataSets(siteId) {
      const dir = dataDir(siteId);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith(CSV_EXTENSION))
        .map((f) => f.slice(0, -CSV_EXTENSION.length));
    },
    readDataSet,
    writeDataSet(siteId, name, rows) {
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('data set requires at least one row');
      const text = serializeCsv(rows as Record<string, unknown>[]);
      mkdirSync(dataDir(siteId), { recursive: true });
      writeFileSync(dataFile(siteId, name), text, 'utf8');
    },
    buildVariableOverridesPerRow(siteId, dataSetName) {
      return readDataSet(siteId, dataSetName).map((row) => ({ ...row }));
    },
  };
}
