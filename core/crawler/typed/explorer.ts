import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Locator, Page } from 'playwright';
import type { BrowserSession } from './browser';
import { firstLine } from './errors';
import { tryNormalizeUrl, tryOrigin } from './urls';

const DEFAULT_MAX_PAGES = 25;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_CLICKS_PER_PAGE = 15;
const NAVIGATION_TIMEOUT_MS = 30_000;
const SETTLE_TIMEOUT_MS = 5_000;
/** Candidates beyond this many per page are ignored. */
const MAX_CANDIDATES_PER_PAGE = 300;
const MAX_LABEL_LENGTH = 80;
const MAX_SLUG_LENGTH = 80;
const CLICK_TIMEOUT_MS = 5_000;
const POST_CLICK_WAIT_MS = 400;
const POST_CLICK_LOAD_TIMEOUT_MS = 3_000;
const DESTRUCTIVE_REASON = '破壊的操作の可能性がある文言を検出';

// Text/aria-label keywords (Japanese + English) that mark a control as likely
// destructive or state-mutating. Matched controls are never clicked in
// "passive" mode — they're only reported so a human can review them.
// Not a security boundary (a control can mutate state without matching any of
// these words) — it reduces, not eliminates, the chance of an unintended
// side effect during exploration.
export const DESTRUCTIVE_KEYWORDS: readonly string[] = [
  '送信', '提出', '確定', '購入', '決済', '注文', '削除', '消去', '破棄', '解約',
  'ログアウト', 'サインアウト', '退会', '同意して', '承認', '承諾',
  'submit', 'send', 'confirm', 'checkout', 'purchase', 'buy', 'pay', 'order',
  'delete', 'remove', 'discard', 'cancel subscription', 'unsubscribe',
  'log out', 'logout', 'sign out', 'deactivate', 'terminate',
];

const CLICKABLE_SELECTOR = 'a[href], button, [role="button"], [role="tab"], [role="menuitem"], summary, [onclick]';

export interface ExploreOptions {
  maxPages?: number;
  maxDepth?: number;
  maxClicksPerPage?: number;
  sameOriginOnly?: boolean;
  screenshotDir?: string;
}

interface LinkCandidate {
  label: string;
  url: string;
  destructive: boolean;
}

interface ControlCandidate {
  label: string;
  destructive: boolean;
  locatorIndex: number;
}

export interface ControlState {
  trigger: string;
  resultingUrl: string;
  screenshot: string | undefined;
}

export interface ExplorePageResult {
  url: string;
  title: string;
  screenshot: string | undefined;
  linkCount: number;
  states: ControlState[];
  skipped: number;
}

export interface SkippedControl {
  pageUrl: string;
  label: string;
  url?: string;
  reason: string;
}

export interface ExplorationResult {
  startUrl: string;
  pages: ExplorePageResult[];
  skipped: SkippedControl[];
  pageCount: number;
}

type Log = (line: string) => void;

export function isDestructiveLabel(text: string | null | undefined): boolean {
  const lower = (text || '').toLowerCase();
  return DESTRUCTIVE_KEYWORDS.some(keyword => lower.includes(keyword.toLowerCase()));
}

function slugifyUrl(rawUrl: string): string {
  return (rawUrl || 'page').replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_SLUG_LENGTH) || 'page';
}

/**
 * Collects every candidate clickable element on the current page, classified
 * as either a same-origin link to queue for a normal page visit (a pure GET
 * navigation — no interaction risk) or a non-navigating control to click and
 * screenshot in isolation (a dropdown/tab/modal toggle, typically). Anything
 * inside a <form> is excluded entirely — form controls belong to the
 * dedicated form-testing pipeline (core/runner/*), not this explorer.
 */
async function collectCandidates(
  page: Page,
  pageUrl: string,
  seedOrigin: string | undefined,
  sameOriginOnly: boolean,
): Promise<{ links: LinkCandidate[]; controls: ControlCandidate[] }> {
  const handles: Locator[] = await page.locator(CLICKABLE_SELECTOR).all();
  const links: LinkCandidate[] = [];
  const controls: ControlCandidate[] = [];
  for (const handle of handles.slice(0, MAX_CANDIDATES_PER_PAGE)) {
    const inForm = await handle.evaluate(el => Boolean(el.closest('form'))).catch(() => true);
    if (inForm) continue;
    const visible = await handle.isVisible().catch(() => false);
    if (!visible) continue;
    const [text, ariaLabel, href, tag] = await Promise.all([
      handle.innerText().catch(() => ''),
      handle.getAttribute('aria-label').catch(() => null),
      handle.getAttribute('href').catch(() => null),
      handle.evaluate(el => el.tagName.toLowerCase()).catch(() => ''),
    ]);
    const label = (text || ariaLabel || '').trim().slice(0, MAX_LABEL_LENGTH) || '(no label)';
    const destructive = isDestructiveLabel(`${text} ${ariaLabel}`);

    if (tag === 'a' && href) {
      const absolute = tryNormalizeUrl(new URL(href, pageUrl).href);
      if (!absolute) continue;
      if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;
      if (sameOriginOnly && tryOrigin(absolute) !== seedOrigin) continue;
      links.push({ label, url: absolute, destructive });
      continue;
    }
    controls.push({ label, destructive, locatorIndex: handles.indexOf(handle) });
  }
  return { links, controls };
}

/**
 * Explores a site by following same-origin links (pure navigation, no risk)
 * and, on each page, clicking non-form, non-destructive-looking controls one
 * at a time in an isolated throwaway tab (so nothing compounds across
 * clicks), screenshotting the resulting state. Anything that looks
 * destructive by its label, or that lives inside a <form>, is reported as
 * skipped rather than clicked — this is exploratory coverage, not a
 * replacement for the dedicated form-testing pipeline.
 */
export async function exploreSite(session: BrowserSession, startUrl: string, options: ExploreOptions, log: Log = () => {}): Promise<ExplorationResult> {
  const maxPages = options.maxPages || DEFAULT_MAX_PAGES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxClicksPerPage = options.maxClicksPerPage || DEFAULT_MAX_CLICKS_PER_PAGE;
  const sameOriginOnly = options.sameOriginOnly !== false;
  const seedOrigin = tryOrigin(startUrl);
  const screenshotDir = options.screenshotDir;
  if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });

  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];
  const queued = new Set<string | undefined>([tryNormalizeUrl(startUrl)]);
  const pages: ExplorePageResult[] = [];
  const skipped: SkippedControl[] = [];

  const page = await session.newPage();
  try {
    while (queue.length && visited.size < maxPages) {
      const next = queue.shift();
      if (!next) break;
      const { url, depth } = next;
      const norm = tryNormalizeUrl(url);
      if (!norm || visited.has(norm)) continue;
      visited.add(norm);

      log(`[explore] (${visited.size}/${maxPages}) depth=${depth} ${url}`);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
      } catch (error) {
        log(`[explore]   skip (navigation failed): ${firstLine(error)}`);
        continue;
      }
      await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});

      const title = await page.title().catch(() => '');
      const shotName = `page-${String(visited.size).padStart(3, '0')}-${slugifyUrl(page.url())}.png`;
      const shotPath = screenshotDir ? join(screenshotDir, shotName) : undefined;
      if (shotPath) await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});

      const { links, controls } = await collectCandidates(page, page.url(), seedOrigin, sameOriginOnly);

      const states: ControlState[] = [];
      for (const control of controls.slice(0, maxClicksPerPage)) {
        if (control.destructive) {
          skipped.push({ pageUrl: page.url(), label: control.label, reason: DESTRUCTIVE_REASON });
          continue;
        }
        const state = await captureControlState(session, page.url(), control, screenshotDir, visited.size, states.length, log);
        if (state) states.push(state);
      }

      pages.push({
        url: page.url(),
        title,
        screenshot: shotPath ? basename(shotPath) : undefined,
        linkCount: links.length,
        states,
        skipped: controls.filter(control => control.destructive).length,
      });

      if (depth < maxDepth) {
        for (const link of links) {
          if (link.destructive) {
            skipped.push({ pageUrl: page.url(), label: link.label, url: link.url, reason: DESTRUCTIVE_REASON });
            continue;
          }
          const normalized = tryNormalizeUrl(link.url);
          if (!normalized || visited.has(normalized) || queued.has(normalized)) continue;
          queue.push({ url: normalized, depth: depth + 1 });
          queued.add(normalized);
        }
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  return { startUrl, pages, skipped, pageCount: pages.length };
}

/** Clicks one control in a fresh, throwaway tab starting from `pageUrl` so state never compounds across candidates. */
async function captureControlState(
  session: BrowserSession,
  pageUrl: string,
  control: ControlCandidate,
  screenshotDir: string | undefined,
  pageIndex: number,
  controlIndex: number,
  log: Log,
): Promise<ControlState | undefined> {
  let probe: Page | undefined;
  try {
    probe = await session.newPage();
    await probe.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    const handles = await probe.locator(CLICKABLE_SELECTOR).all();
    const target = handles[control.locatorIndex];
    if (!target) return undefined;
    await target.click({ timeout: CLICK_TIMEOUT_MS, trial: false }).catch(() => {});
    await probe.waitForTimeout(POST_CLICK_WAIT_MS);
    await probe.waitForLoadState('domcontentloaded', { timeout: POST_CLICK_LOAD_TIMEOUT_MS }).catch(() => {});
    const resultingUrl = probe.url();
    const shotName = `page-${String(pageIndex).padStart(3, '0')}-click-${controlIndex}.png`;
    const shotPath = screenshotDir ? join(screenshotDir, shotName) : undefined;
    if (shotPath) await probe.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    log(`[explore]   clicked "${control.label}" -> ${resultingUrl === pageUrl ? '(same page, state change)' : resultingUrl}`);
    return { trigger: control.label, resultingUrl, screenshot: shotPath ? basename(shotPath) : undefined };
  } catch (error) {
    log(`[explore]   click failed on "${control.label}": ${firstLine(error)}`);
    return undefined;
  } finally {
    await probe?.close().catch(() => {});
  }
}
