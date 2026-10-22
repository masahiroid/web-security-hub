import { VEX_API, vexLabel, vexText, type VexLabel } from './config.js';
import { ensureSession, object, request, type JsonObject } from '../verifier/client.js';
import { field, get } from '../verifier/view.js';

const panel = get('panel-vex');
let draft: JsonObject | null = null; let evidence: JsonObject[] = []; let selectedStatement: string | null = null; let exported: unknown = null; let notice = '';
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (id: string) => field(id).value.trim();
const approved = () => !!draft && object(draft.review).state === 'approved';
function status(message: string) { get('vexStatus').textContent = message; }
function option(value: string, label: string): HTMLOptionElement { const element = document.createElement('option'); element.value = value; element.textContent = label; return element; }
async function call(url: string, body?: unknown): Promise<JsonObject> {
  try { return await request(url, body); } catch { status(vexText('failed')); throw Error('vex_failed'); }
}
function evidenceLabel(entry: JsonObject): string {
  return `${vexLabel(entry.kind)} · ${String(entry.createdAt).slice(0, 16).replace('T', ' ')} · ${vexLabel(entry.observation)} · ${String(entry.reportId).slice(0, 8)}`;
}
function renderEvidence() {
  const select = field('vexEvidence'); select.replaceChildren(...evidence.map(entry => option(`${String(entry.kind)}:${String(entry.reportId)}`, evidenceLabel(entry))));
  get('vexEvidenceEmpty').hidden = evidence.length > 0;
}
function chosenEvidence(): { kind: string; reportId: string }[] {
  const select = field('vexEvidence');
  return select instanceof HTMLSelectElement ? [...select.selectedOptions].map(entry => { const [kind = '', reportId = ''] = entry.value.split(':'); return { kind, reportId }; }) : [];
}
function syncForm() {
  const value = field('vexStatusValue').value; const locked = approved() || !draft;
  get('vexJustificationField').hidden = value !== 'not_affected'; get('vexActionField').hidden = value !== 'affected';
  for (const id of ['vexVulnerability', 'vexDescription', 'vexProduct', 'vexProductHash', 'vexStatusValue', 'vexBasis', 'vexJustification', 'vexAction', 'vexNotes', 'vexEvidence']) field(id).toggleAttribute('disabled', locked);
  for (const id of ['vexSave', 'vexSuggest', 'vexRemove']) get(id).toggleAttribute('disabled', locked || (id === 'vexRemove' && !selectedStatement));
  get('vexApprove').toggleAttribute('disabled', !draft || locked || array(draft.statements).length === 0);
  get('vexExport').toggleAttribute('disabled', !approved()); get('vexRevise').toggleAttribute('disabled', !approved());
  field('vexApprover').toggleAttribute('disabled', !draft || locked);
  get('vexReviewerNote').hidden = !(['not_affected', 'fixed'].includes(value));
}
function renderDraft() {
  const rows = get('vexRows'); rows.replaceChildren();
  get('vexSummary').textContent = draft ? `${vexText('version')} ${String(draft.version)} · ${approved() ? vexText('approved') : vexText('draftState')}` : vexText('idle');
  if (draft) for (const raw of array(draft.statements)) {
    const entry = object(raw); const row = document.createElement('tr'); row.tabIndex = 0;
    const product = array(entry.products).map(object).map(item => String(item.id)).join(', ');
    for (const value of [entry.vulnerability, product, vexLabel(entry.status), vexLabel(entry.basis), array(entry.evidence).length]) { const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell); }
    if (entry.statementId === selectedStatement) row.classList.add('verifier-reproduced');
    const pick = () => { selectedStatement = String(entry.statementId); fillForm(entry); renderDraft(); };
    row.addEventListener('click', pick); row.addEventListener('keydown', event => { if (event.key === 'Enter') pick(); }); rows.append(row);
  }
  if (draft && !array(draft.statements).length) get('vexSummary').textContent += ` · ${vexText('empty')}`;
  get('vexSaved').textContent = notice; syncForm();
}
function fillForm(entry: JsonObject) {
  field('vexVulnerability').value = String(entry.vulnerability); field('vexDescription').value = String(entry.description ?? '');
  const product = object(array(entry.products)[0] ?? {}); field('vexProduct').value = String(product.id ?? ''); field('vexProductHash').value = String(product.sha256 ?? '');
  field('vexStatusValue').value = String(entry.status); field('vexBasis').value = String(entry.basis); field('vexJustification').value = String(entry.justification ?? 'component_not_present');
  field('vexAction').value = String(entry.actionStatement ?? ''); field('vexNotes').value = String(entry.statusNotes ?? '');
  const wanted = new Set(array(entry.evidence).map(object).map(item => `${String(item.kind)}:${String(item.reportId)}`));
  const select = field('vexEvidence'); if (select instanceof HTMLSelectElement) for (const item of select.options) item.selected = wanted.has(item.value);
  syncForm();
}
function statementBody() {
  const products = [{ id: text('vexProduct'), ...(text('vexProductHash') ? { sha256: text('vexProductHash') } : {}) }]; const value = text('vexStatusValue');
  return { vulnerability: text('vexVulnerability'), ...(text('vexDescription') ? { description: text('vexDescription') } : {}), products, status: value, basis: text('vexBasis'),
    ...(value === 'not_affected' ? { justification: text('vexJustification') } : {}), ...(value === 'affected' && text('vexAction') ? { actionStatement: text('vexAction') } : {}),
    ...(text('vexNotes') ? { statusNotes: text('vexNotes') } : {}), evidence: chosenEvidence() };
}
async function loadDrafts(selectId?: string) {
  const list = array((await call(VEX_API.drafts)).drafts).map(object);
  const select = field('vexDraftPick'); select.replaceChildren(option('', '—'), ...list.map(entry => option(String(entry.draftId), `${String(entry.createdAt).slice(0, 16).replace('T', ' ')} · ${String(entry.author)} · v${String(entry.version)}`)));
  if (selectId) { select.value = selectId; }
}
async function open(id: string) {
  if (!id) { draft = null; selectedStatement = null; exported = null; renderDraft(); return; }
  draft = await call(`${VEX_API.drafts}/${id}`); selectedStatement = null; exported = null; notice = ''; get('vexDocument').textContent = ''; renderDraft();
}
function after(next: JsonObject, message = vexText('saved')) { draft = next; notice = message; status(message); renderDraft(); }
get('vexCreate').addEventListener('click', async () => {
  if (!text('vexAuthor')) { field('vexAuthor').focus(); return; }
  try { const created = await call(VEX_API.drafts, { author: text('vexAuthor'), role: text('vexRole') }); await loadDrafts(String(created.draftId)); draft = created; selectedStatement = null; exported = null; notice = ''; renderDraft(); status(vexText('saved')); } catch { /* status shown */ }
});
field('vexDraftPick').addEventListener('change', () => { void open(field('vexDraftPick').value).catch(() => {}); });
get('vexSave').addEventListener('click', async () => {
  if (!draft) return;
  for (const id of ['vexVulnerability', 'vexProduct']) if (!field(id).checkValidity()) { field(id).reportValidity(); return; }
  try {
    const base = `${VEX_API.drafts}/${String(draft.draftId)}/statements`;
    after(await call(selectedStatement ? `${base}/${selectedStatement}` : base, { statement: statementBody() })); selectedStatement = null;
  } catch { /* status shown */ }
});
get('vexRemove').addEventListener('click', async () => { if (draft && selectedStatement) { try { after(await call(`${VEX_API.drafts}/${String(draft.draftId)}/statements/${selectedStatement}/delete`, {})); selectedStatement = null; } catch { /* status shown */ } } });
get('vexSuggest').addEventListener('click', async () => {
  try { const suggestion = await call(VEX_API.suggest, { evidence: chosenEvidence() }); field('vexStatusValue').value = String(suggestion.status); if (suggestion.status === 'affected') field('vexBasis').value = 'evidence'; syncForm(); status(`${vexText('suggested')}: ${vexLabel(suggestion.status)}`); } catch { /* status shown */ }
});
get('vexApprove').addEventListener('click', async () => {
  if (!draft) return; if (!text('vexApprover')) { field('vexApprover').focus(); return; }
  try { after(await call(`${VEX_API.drafts}/${String(draft.draftId)}/approve`, { approver: text('vexApprover') }), vexText('approved')); await loadDrafts(String(draft?.draftId)); } catch { /* status shown */ }
});
get('vexExport').addEventListener('click', async () => {
  if (!draft) return;
  try { exported = (await call(`${VEX_API.drafts}/${String(draft.draftId)}/export`, {})).document; get('vexDocument').textContent = JSON.stringify(exported, null, 2); get('vexDownload').hidden = false; document.querySelector<HTMLButtonElement>('[data-vpage=vexDocumentPage]')?.click(); } catch { /* status shown */ }
});
get('vexDownload').addEventListener('click', event => {
  event.preventDefault(); if (!exported) return;
  const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([`${JSON.stringify(exported, null, 2)}\n`], { type: 'application/json' }));
  link.href = url; link.download = VEX_API.fileName; link.click(); URL.revokeObjectURL(url);
});
get('vexRevise').addEventListener('click', async () => { if (draft) { try { const revision = await call(`${VEX_API.drafts}/${String(draft.draftId)}/revise`, {}); await loadDrafts(String(revision.draftId)); after(revision); } catch { /* status shown */ } } });
field('vexStatusValue').addEventListener('change', () => { if (field('vexStatusValue').value !== 'affected' && field('vexStatusValue').value !== 'under_investigation') field('vexBasis').value = 'reviewer'; syncForm(); });
for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-vpage]')) {
  button.setAttribute('role', 'tab'); button.id = `tab-${button.dataset.vpage}`; button.setAttribute('aria-controls', button.dataset.vpage ?? '');
  const page = document.getElementById(button.dataset.vpage ?? ''); page?.setAttribute('role', 'tabpanel'); page?.setAttribute('aria-labelledby', button.id);
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault();
    const peers = [...panel.querySelectorAll<HTMLButtonElement>(`[data-vgroup="${button.dataset.vgroup}"]`)];
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? peers.length - 1 : (peers.indexOf(button) + (event.key === 'ArrowRight' ? 1 : -1) + peers.length) % peers.length;
    peers[index]?.click(); peers[index]?.focus();
  });
  button.addEventListener('click', () => {
    const group = button.dataset.vgroup;
    for (const peer of panel.querySelectorAll<HTMLButtonElement>(`[data-vgroup="${group}"]`)) peer.setAttribute('aria-selected', String(peer === button));
    for (const section of panel.querySelectorAll<HTMLElement>(`[data-vbody="${group}"]`)) section.hidden = section.id !== button.dataset.vpage;
  });
}
function translate() {
  panel.querySelectorAll<HTMLElement>('[data-xlabel]').forEach(element => { const key = element.dataset.xlabel; if (key) element.textContent = vexText(key as VexLabel); });
  get('vexNav').textContent = vexText('nav'); renderEvidence(); get('vexEvidenceEmpty').textContent = vexText('noEvidence'); renderDraft();
  if (!draft) status(vexText('idle'));
}
const selectedValue = (id: string) => field(id).value;
new MutationObserver(() => { const keep = [selectedValue('vexStatusValue'), selectedValue('vexBasis'), selectedValue('vexJustification')]; translate(); field('vexStatusValue').value = keep[0] ?? 'under_investigation'; field('vexBasis').value = keep[1] ?? 'evidence'; field('vexJustification').value = keep[2] ?? 'component_not_present'; syncForm(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
get('vexNav').addEventListener('click', () => { void (async () => { try { evidence = array((await call(VEX_API.evidence)).evidence).map(object); renderEvidence(); await loadDrafts(draft ? String(draft.draftId) : undefined); } catch { /* status shown */ } })(); });
translate(); void ensureSession().then(() => call(VEX_API.evidence)).then(result => { evidence = array(result.evidence).map(object); renderEvidence(); return loadDrafts(); }).catch(() => status(vexText('failed')));
