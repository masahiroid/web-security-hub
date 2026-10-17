import { t } from './i18n.js';
'use strict';
import { $ } from './dom.js';
import { api } from './api.js';
import { state } from './state.js';

/** 再実行 tab, "テストケースを編集" section: a table editor over test-cases.yaml. */

let editorGroups = [];

function shortSelectorLabel(sel) {
  const m = sel.match(/name="([^"]+)"\]?\[?placeholder="([^"]+)"/);
  if (m) return `${m[2]}`;
  const nameOnly = sel.match(/name="([^"]+)"/);
  if (nameOnly) return nameOnly[1];
  return sel.replace(/^#/, '').slice(0, 24);
}

function renderCaseEditor() {
  const container = $('caseEditorTables');
  container.innerHTML = '';
  editorGroups.forEach((group, gIdx) => {
    const cases = group.cases ?? [];
    const selectors = Array.from(
      new Set(cases.flatMap((c) => Object.keys(c.assignments ?? {}).filter((s) => !s.startsWith('__')))),
    );

    const table = document.createElement('table');
    table.className = 'case-editor-table';
    table.style.cssText = 'width:100%; border-collapse:collapse; margin-bottom:16px; font-size:13px';
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>
      <th style="text-align:left; padding:6px">Case ID</th>
      <th style="text-align:left; padding:6px">${t('label.caseName')}</th>
      ${selectors.map((s) => `<th style="text-align:left; padding:6px">${shortSelectorLabel(s)}</th>`).join('')}
      <th style="padding:6px"></th>
    </tr>`;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    cases.forEach((c, cIdx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:4px; font-family:monospace">${c.id}</td>
        <td style="padding:4px">${c.name}</td>
        ${selectors
          .map((s) => {
            const a = c.assignments?.[s];
            if (!a) return '<td style="padding:4px">—</td>';
            return `<td style="padding:4px"><input data-g="${gIdx}" data-c="${cIdx}" data-sel="${encodeURIComponent(s)}" value="${(a.value ?? '').replace(/"/g, '&quot;')}" style="width:100%" /></td>`;
          })
          .join('')}
        <td style="padding:4px"><button type="button" class="secondary" data-remove-g="${gIdx}" data-remove-c="${cIdx}">${t('remove')}</button></td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    const caption = document.createElement('p');
    caption.className = 'hint';
    caption.textContent = group.url;
    container.appendChild(caption);
    container.appendChild(table);
  });

  container.querySelectorAll('button[data-remove-g]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const g = Number(btn.dataset.removeG);
      const c = Number(btn.dataset.removeC);
      editorGroups[g].cases.splice(c, 1);
      renderCaseEditor();
    });
  });
}

function collectCaseEditorEdits() {
  document.querySelectorAll('#caseEditorTables input[data-sel]').forEach((input) => {
    const g = Number(input.dataset.g);
    const c = Number(input.dataset.c);
    const sel = decodeURIComponent(input.dataset.sel);
    const assignment = editorGroups[g]?.cases?.[c]?.assignments?.[sel];
    if (assignment) assignment.value = input.value;
  });
  return editorGroups;
}

$('loadCaseEditorBtn').addEventListener('click', async () => {
  const status = $('caseEditorStatus');
  if (!state.siteId) {
    status.textContent = t('error.selectSite');
    return;
  }
  const sessionId = $('replaySession').value;
  if (!sessionId) {
    status.textContent = t('error.selectSession');
    return;
  }
  status.textContent = t('status.loading');
  try {
    const data = await api(`/sites/${state.siteId}/sessions/${sessionId}/test-cases`);
    editorGroups = data.testCaseGroups ?? [];
    renderCaseEditor();
    status.textContent = t('status.casesLoaded', { count: editorGroups.reduce((n, g) => n + (g.cases?.length ?? 0), 0) });
    $('saveCaseEditorBtn').style.display = editorGroups.length ? 'inline-block' : 'none';
  } catch (e) {
    status.textContent = t('status.error', { message: e.message });
  }
});

$('saveCaseEditorBtn').addEventListener('click', async () => {
  const status = $('caseEditorStatus');
  const sessionId = $('replaySession').value;
  if (!state.siteId || !sessionId) return;
  status.textContent = t('status.regenerating');
  try {
    const testCaseGroups = collectCaseEditorEdits();
    await api(`/sites/${state.siteId}/sessions/${sessionId}/test-cases`, {
      method: 'PUT',
      body: JSON.stringify({ testCaseGroups }),
    });
    status.textContent = t('status.regenerated');
  } catch (e) {
    status.textContent = t('status.error', { message: e.message });
  }
});
