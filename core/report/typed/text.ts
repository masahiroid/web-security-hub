/** Text helpers shared by the report writers. */

/** Converts any JSON value to display text; null and undefined become the empty string. */
export function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

export function escapeHtml(value: unknown): string {
  return textOf(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Escapes text for one Markdown table cell. */
export function escapeMarkdownCell(value: unknown): string {
  return textOf(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + (parsed.search || '');
  } catch {
    return url;
  }
}

export function shortSelector(selector: string): string {
  const named = /name="([^"]+)"/.exec(selector);
  if (named?.[1] !== undefined) return named[1];
  return selector.replace(/^#/, '');
}

export type CaseKind = 'abnormal' | 'boundary' | 'normal';

export function kindOfCase(name: string): CaseKind {
  if (name.includes('異常') || /abnormal/i.test(name)) return 'abnormal';
  if (name.includes('境界') || /boundary/i.test(name)) return 'boundary';
  return 'normal';
}

/** UTC time as "YYYY-MM-DD HH:MM:SS". */
export function formatTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}
