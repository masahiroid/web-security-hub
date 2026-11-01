import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml } from './text';

export interface ExploreState {
  readonly trigger: string;
  readonly resultingUrl: string;
  readonly screenshot?: string | undefined;
}

export interface ExplorePage {
  readonly url: string;
  readonly title?: string | undefined;
  readonly screenshot?: string | undefined;
  readonly linkCount: number;
  readonly skipped: number;
  readonly states: readonly ExploreState[];
}

export interface ExploreSkip {
  readonly pageUrl: string;
  readonly label: string;
  readonly reason: string;
}

export interface ExploreResult {
  readonly startUrl: string;
  readonly pageCount: number;
  readonly pages: readonly ExplorePage[];
  readonly skipped: readonly ExploreSkip[];
}

/** Writes explore-report.json and explore-report.html for one exploration session. */
export function writeExploreReport(sessionDir: string, result: ExploreResult): string {
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'explore-report.json'), JSON.stringify(result, null, 2), 'utf8');

  const stateCount = result.pages.reduce((count, page) => count + page.states.length, 0);
  const pageRows = result.pages
    .map(
      (p: ExplorePage) => `
    <section class="page">
      <h2>${escapeHtml(p.title || '(no title)')}</h2>
      <p class="url"><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.url)}</a></p>
      ${p.screenshot ? `<img src="screenshots/${escapeHtml(p.screenshot)}" alt="screenshot" loading="lazy">` : ''}
      <p class="meta">リンク ${p.linkCount} 件 / クリック探索 ${p.states.length} 件 / スキップ ${p.skipped} 件</p>
      ${
        p.states.length
          ? `<div class="states">${p.states
              .map(
                (s: ExploreState) => `
        <figure>
          ${s.screenshot ? `<img src="screenshots/${escapeHtml(s.screenshot)}" alt="${escapeHtml(s.trigger)}" loading="lazy">` : ''}
          <figcaption>「${escapeHtml(s.trigger)}」をクリック${s.resultingUrl !== p.url ? ` → ${escapeHtml(s.resultingUrl)}` : ''}</figcaption>
        </figure>`,
              )
              .join('')}</div>`
          : ''
      }
    </section>`,
    )
    .join('\n');

  const skippedRows = result.skipped
    .map((skip: ExploreSkip) => `<tr><td>${escapeHtml(skip.pageUrl)}</td><td>${escapeHtml(skip.label)}</td><td>${escapeHtml(skip.reason)}</td></tr>`)
    .join('\n');

  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>探索レポート</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 24px; color: #1e2420; background: #f6f7f5; }
  h1 { font-size: 20px; } h2 { font-size: 15px; margin-bottom: 4px; }
  .summary { color: #5b6459; margin-bottom: 24px; }
  section.page { background: #fff; border: 1px solid #d9ddd3; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  .url { font-size: 12px; color: #5b6459; word-break: break-all; }
  .meta { font-size: 12px; color: #5b6459; }
  img { max-width: 320px; border: 1px solid #d9ddd3; border-radius: 6px; margin: 4px 8px 4px 0; }
  .states { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
  figure { margin: 0; font-size: 11px; color: #5b6459; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  td, th { border: 1px solid #d9ddd3; padding: 6px 8px; font-size: 12px; text-align: left; }
</style></head>
<body>
  <h1>探索レポート</h1>
  <p class="summary">起点: ${escapeHtml(result.startUrl)} / 訪問ページ ${result.pageCount} / クリック探索 ${stateCount} 件 / スキップ ${result.skipped.length} 件（破壊的操作の可能性があり未クリック）</p>
  ${pageRows}
  ${
    result.skipped.length
      ? `<h2>スキップした操作（要目視確認）</h2>
  <table><tr><th>ページ</th><th>ラベル</th><th>理由</th></tr>${skippedRows}</table>`
      : ''
  }
</body></html>`;

  const output = join(sessionDir, 'explore-report.html');
  writeFileSync(output, html, 'utf8');
  return output;
}
