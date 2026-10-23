import type { StaticScanResult } from './staticScanner';
export const REPORT_ROOT: string;
export function persistStaticReport(scan: StaticScanResult, now?: Date): Record<string, unknown>;
