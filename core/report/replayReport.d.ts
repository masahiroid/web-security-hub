export function parseListReporterLines(lines: readonly string[]): unknown[];
export function writeReplayReport(sessionDir: string, options: { results: readonly unknown[]; exitCode: number | null; baseUrl: string }): string;
