import { scanStatic } from '../../../core/security/staticScanner';
import { persistStaticReport } from '../../../core/security/staticReport';

/** Analyzes a source directory and persists its reports under the static-analysis results area. */
export function runStaticScan(sourceDir: string) {
  const result = scanStatic({ sourceDir });
  return { ...result, report: persistStaticReport(result) };
}
