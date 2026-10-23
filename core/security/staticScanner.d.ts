export interface StaticScanResult { readonly sourceDir: string; readonly [key: string]: unknown }
export function scanStatic(options: { sourceDir: string; onProgress?: (line: string) => void }): StaticScanResult;
