import { createHash } from 'node:crypto';

/** Selector/URL normalization and lightweight error-text extraction, with no browser dependency. */

/** At most this many distinct error strings are kept per page. */
export const MAX_ERROR_MESSAGES = 20;

const ERROR_CLASS_TEXT = /class="[^"]*(error|invalid|alert|danger|warning)[^"]*"[^>]*>([^<]{1,200})</gi;

const ERROR_TEXT_HINTS: readonly { readonly tag: string; readonly re: RegExp }[] = [
  { tag: 'error', re: /エラー|error/i },
  { tag: 'invalid', re: /不正|誤り|invalid/i },
  { tag: 'required-input', re: /入力してください|please enter/i },
  { tag: 'required-select', re: /選択してください|please select/i },
  { tag: 'required-missing', re: /未入力|入力されていません|is required/i },
];

/** `#foo[bar]` is not a valid id shorthand in CSS, so it becomes an attribute selector. */
export function normalizeSelectorForRuntime(selector: string): string;
export function normalizeSelectorForRuntime(selector: string | null | undefined): string | null | undefined;
export function normalizeSelectorForRuntime(selector: string | null | undefined): string | null | undefined {
  if (!selector || !selector.startsWith('#')) return selector;
  const id = selector.slice(1);
  if (!/[[\]]/.test(id)) return selector;
  const escaped = id.replace(/["\\]/g, '\\$&');
  return `[id="${escaped}"]`;
}

/** Path plus query; the input is returned unchanged when it is not a URL. */
export function normalizePathForCompare(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** Rough extraction of error-looking text from response HTML. */
export function extractErrors(html: string): string[] {
  const out: string[] = [];
  const re = new RegExp(ERROR_CLASS_TEXT.source, ERROR_CLASS_TEXT.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = (m[2] ?? '').trim();
    if (text) out.push(text);
  }
  return Array.from(new Set(out)).slice(0, MAX_ERROR_MESSAGES);
}

export function extractErrorTextHints(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const p of ERROR_TEXT_HINTS) if (p.re.test(text)) out.push(`error-text:${p.tag}`);
  return out;
}

export function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}
