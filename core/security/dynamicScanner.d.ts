export interface DynamicScanOptions {
  targetUrl: string | undefined;
  maxPages?: unknown;
  maxDepth?: unknown;
  allowActiveScan?: unknown;
  scenario?: unknown;
  zap?: unknown;
  onProgress?: (line: string) => void;
}
export function scanDynamic(options: DynamicScanOptions): Promise<Record<string, unknown>>;
