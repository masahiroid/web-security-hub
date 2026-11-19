/** Minimal CSV used for data sets: double quotes escape commas, quotes ("") and newlines. Pure. */

export type CsvRow = Record<string, string>;

/** Parses one line honoring double-quote escaping. */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (line.charAt(i + 1) === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

/** Rows keyed by the trimmed header row; blank lines are skipped and missing cells become ''. */
export function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const [headerLine, ...body] = lines;
  if (headerLine === undefined) return [];
  const header = parseCsvLine(headerLine).map((h) => h.trim());
  return body.map((line) => {
    const cells = parseCsvLine(line);
    const row: CsvRow = {};
    header.forEach((key, index) => {
      row[key] = cells[index] ?? '';
    });
    return row;
  });
}

function escapeCell(value: unknown): string {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header comes from the first row's keys. */
export function serializeCsv(rows: readonly Readonly<Record<string, unknown>>[]): string {
  const [first] = rows;
  if (!first) throw new Error('data set requires at least one row');
  const header = Object.keys(first);
  const lines = [header.join(','), ...rows.map((row) => header.map((key) => escapeCell(row[key])).join(','))];
  return lines.join('\n') + '\n';
}
