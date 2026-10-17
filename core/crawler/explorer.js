'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_PAGES = 25;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_CLICKS_PER_PAGE = 15;

// Text/aria-label keywords (Japanese + English) that mark a control as likely
// destructive or state-mutating. Matched controls are never clicked in
// "passive" mode — they're only reported so a human can review them.
// Not a security boundary (a control can mutate state without matching any of
// these words) — it reduces, not eliminates, the chance of an unintended
// side effect during exploration.
const DESTRUCTIVE_KEYWORDS = [
  '送信', '提出', '確定', '購入', '決済', '注文', '削除', '消去', '破棄', '解約',
  'ログアウト', 'サインアウト', '退会', '同意して', '承認', '承諾',
  'submit', 'send', 'confirm', 'checkout', 'purchase', 'buy', 'pay', 'order',
  'delete', 'remove', 'discard', 'cancel subscription', 'unsubscribe',
  'log out', 'logout', 'sign out', 'deactivate', 'terminate',
];

const CLICKABLE_SELECTOR = 'a[href], button, [role="button"], [role="tab"], [role="menuitem"], summary, [onclick]';

function isDestructiveLabel(text) {
  const lower = (text || '').toLowerCase();
  return DESTRUCTIVE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    return u.href;
  } catch {
    return undefined;
  }
}

function safeOrigin(rawUrl) {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return undefined;
  }
}

function slugifyUrl(rawUrl) {
  return (rawUrl || 'page').replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'page';
}

/**
 * Collects every candidate clickable element on the current page, classified
 * as either a same-origin link to queue for a normal page visit (a pure GET
 * navigation — no interaction risk) or a non-navigating control to click and
 * screenshot in isolation (a dropdown/tab/modal toggle, typically). Anything
 * inside a <form> is excluded entirely — form controls belong to the
 * dedicated form-testing pipeline (core/runner/*), not this explorer.
 */
async function collectCandidates(page, pageUrl, seedOrigin, sameOriginOnly) {
  const handles = await page.locator(CLICKABLE_SELECTOR).all();
  const links = [];
  const controls = [];
  for (const handle of handles.slice(0, 300)) {
    const inForm = await handle.evaluate((el) => Boolean(el.closest('form'))).catch(() => true);
    if (inForm) continue;
    const visible = await handle.isVisible().catch(() => false);
    if (!visible) continue;
    const [text, ariaLabel, href, tag] = await Promise.all([
      handle.innerText().catch(() => ''),
      handle.getAttribute('aria-label').catch(() => null),
      handle.getAttribute('href').catch(() => null),
      handle.evaluate((el) => el.tagName.toLowerCase()).catch(() => ''),
    ]);
    const label = (text || ariaLabel || '').trim().slice(0, 80) || '(no label)';
    const destructive = isDestructiveLabel(`${text} ${ariaLabel}`);

    if (tag === 'a' && href) {
      const absolute = normalizeUrl(new URL(href, pageUrl).href);
      if (!absolute) continue;
      if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;
      if (sameOriginOnly && safeOrigin(absolute) !== seedOrigin) continue;
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
 *
 * @param {import('./browser').BrowserSession} session
 * @param {string} startUrl
 * @param {{maxPages?:number, maxDepth?:number, maxClicksPerPage?:number, sameOriginOnly?:boolean, screenshotDir?:string}} options
 * @param {(line:string)=>void} log
 */
async function exploreSite(session, startUrl, options, log = () => {}) {
  const maxPages = options.maxPages || DEFAULT_MAX_PAGES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxClicksPerPage = options.maxClicksPerPage || DEFAULT_MAX_CLICKS_PER_PAGE;
  const sameOriginOnly = options.sameOriginOnly !== false;
  const seedOrigin = safeOrigin(startUrl);
  const screenshotDir = options.screenshotDir;
  if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });

  const visited = new Set();
  const queue = [{ url: startUrl, depth: 0 }];
  const queued = new Set([normalizeUrl(startUrl)]);
  const pages = [];
  const skipped = [];

  const page = await session.newPage();
  try {
    while (queue.length && visited.size < maxPages) {
      const { url, depth } = queue.shift();
      const norm = normalizeUrl(url);
      if (!norm || visited.has(norm)) continue;
      visited.add(norm);

      log(`[explore] (${visited.size}/${maxPages}) depth=${depth} ${url}`);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch (e) {
        log(`[explore]   skip (navigation failed): ${e.message?.split('\n')[0] ?? e}`);
        continue;
      }
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

      const title = await page.title().catch(() => '');
      const shotName = `page-${String(visited.size).padStart(3, '0')}-${slugifyUrl(page.url())}.png`;
      const shotPath = screenshotDir ? path.join(screenshotDir, shotName) : undefined;
      if (shotPath) await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});

      const { links, controls } = await collectCandidates(page, page.url(), seedOrigin, sameOriginOnly);

      const states = [];
      for (const control of controls.slice(0, maxClicksPerPage)) {
        if (control.destructive) {
          skipped.push({ pageUrl: page.url(), label: control.label, reason: '破壊的操作の可能性がある文言を検出' });
          continue;
        }
        const state = await captureControlState(session, page.url(), control, screenshotDir, visited.size, states.length, log);
        if (state) states.push(state);
      }

      pages.push({ url: page.url(), title, screenshot: shotPath ? path.basename(shotPath) : undefined, linkCount: links.length, states, skipped: controls.filter((c) => c.destructive).length });

      if (depth < maxDepth) {
        for (const link of links) {
          if (link.destructive) {
            skipped.push({ pageUrl: page.url(), label: link.label, url: link.url, reason: '破壊的操作の可能性がある文言を検出' });
            continue;
          }
          const n = normalizeUrl(link.url);
          if (!n || visited.has(n) || queued.has(n)) continue;
          queue.push({ url: n, depth: depth + 1 });
          queued.add(n);
        }
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  return { startUrl, pages, skipped, pageCount: pages.length };
}

/** Clicks one control in a fresh, throwaway tab starting from `pageUrl` so state never compounds across candidates. */
async function captureControlState(session, pageUrl, control, screenshotDir, pageIndex, controlIndex, log) {
  let probe;
  try {
    probe = await session.newPage();
    await probe.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const handles = await probe.locator(CLICKABLE_SELECTOR).all();
    const target = handles[control.locatorIndex];
    if (!target) return undefined;
    await target.click({ timeout: 5_000, trial: false }).catch(() => {});
    await probe.waitForTimeout(400);
    await probe.waitForLoadState('domcontentloaded', { timeout: 3_000 }).catch(() => {});
    const resultingUrl = probe.url();
    const shotName = `page-${String(pageIndex).padStart(3, '0')}-click-${controlIndex}.png`;
    const shotPath = screenshotDir ? path.join(screenshotDir, shotName) : undefined;
    if (shotPath) await probe.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    log(`[explore]   clicked "${control.label}" -> ${resultingUrl === pageUrl ? '(same page, state change)' : resultingUrl}`);
    return { trigger: control.label, resultingUrl, screenshot: shotPath ? path.basename(shotPath) : undefined };
  } catch (e) {
    log(`[explore]   click failed on "${control.label}": ${e.message?.split('\n')[0] ?? e}`);
    return undefined;
  } finally {
    await probe?.close().catch(() => {});
  }
}

module.exports = { exploreSite, isDestructiveLabel, DESTRUCTIVE_KEYWORDS };
