import type { BrowserSession } from './browser';
export interface ExplorationResult {
  readonly pageCount: number;
  readonly pages: readonly { readonly states: readonly unknown[] }[];
  readonly skipped: readonly unknown[];
  readonly [key: string]: unknown;
}
export function exploreSite(session: BrowserSession, startUrl: string,
  options: { maxPages?: number; maxDepth?: number; maxClicksPerPage?: number; sameOriginOnly?: boolean; screenshotDir?: string },
  log?: (line: string) => void): Promise<ExplorationResult>;
