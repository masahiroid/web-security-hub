export function listDataSets(siteId: string): string[];
export function readDataSet(siteId: string, name: string): Record<string, string>[];
export function writeDataSet(siteId: string, name: string, rows: unknown): void;
