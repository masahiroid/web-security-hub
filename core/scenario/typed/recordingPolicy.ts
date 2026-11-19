import type { HealHint } from './types';

/** What a recording may keep: no secrets, no input values unless explicitly allowed. Pure. */

/** Selectors that look like credential fields; their values are never recorded. */
export const SENSITIVE_NAME = /(pass(word)?|secret|token|api[_-]?key|authorization|credential)/i;

export type RecordedStep =
  | { action: 'fill' | 'select'; selector: string; value: string; healHint: HealHint | undefined }
  | { action: 'check' | 'click'; selector: string; healHint: HealHint | undefined };

export function assertHttpUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('recording target must use http or https');
  return url.href;
}

export function sanitizeRecordedStep(raw: unknown, includeInputValues: boolean): RecordedStep | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const step = raw as Record<string, unknown>;
  const hint = step['healHint'];
  const healHint = hint && typeof hint === 'object' ? (hint as HealHint) : undefined;
  const selector = String(step['selector'] || '');
  const action = step['action'];
  if (action === 'fill') {
    if (!includeInputValues || SENSITIVE_NAME.test(selector)) return undefined;
    return { action, selector, value: String(step['value'] || ''), healHint };
  }
  if (action === 'select') return { action, selector, value: String(step['value'] || ''), healHint };
  if (action === 'check' || action === 'click') return { action, selector, healHint };
  return undefined;
}

/** Injected into the recorded page; reports clicks, choices and non-sensitive typed values. */
export const RECORDER_SCRIPT = `(() => {
  if (window.__webSecurityHubRecorderInstalled) return;
  window.__webSecurityHubRecorderInstalled = true;
  const escape = (value) => window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  const selectorFor = (element) => {
    if (!element || element.nodeType !== 1) return null;
    if (element.id) return '#' + escape(element.id);
    for (const attribute of ['data-testid', 'data-test', 'name']) {
      const value = element.getAttribute(attribute);
      if (value) return '[' + attribute + '="' + String(value).replace(/"/g, '\\\\"') + '"]';
    }
    const tag = element.tagName.toLowerCase();
    const type = element.getAttribute('type');
    if (type) return tag + '[type="' + String(type).replace(/"/g, '\\\\"') + '"]';
    return tag;
  };
  const sensitive = (element) => element.type === 'password' || /pass(word)?|secret|token|api[_-]?key|authorization|credential/i.test((element.name || '') + ' ' + (element.id || ''));
  const healHintFor = (element) => {
    if (!element || element.nodeType !== 1) return undefined;
    const attr = (name) => element.getAttribute(name) || undefined;
    const text = (element.innerText || element.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60) || undefined;
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || undefined,
      dataTestId: attr('data-testid') || attr('data-test'),
      name: attr('name'),
      type: attr('type'),
      role: attr('role'),
      ariaLabel: attr('aria-label'),
      placeholder: attr('placeholder'),
      text,
      classes: element.className && typeof element.className === 'string' ? element.className.trim().split(/\\s+/).slice(0, 3) : undefined,
    };
  };
  const send = (payload) => window.__recordScenarioInteraction(payload).catch(() => {});
  document.addEventListener('click', (event) => {
    const element = event.target.closest('a,button,input[type="submit"],input[type="button"],[role="button"]');
    const selector = selectorFor(element);
    if (selector) send({ action: 'click', selector, healHint: healHintFor(element) });
  }, true);
  document.addEventListener('change', (event) => {
    const element = event.target;
    const selector = selectorFor(element);
    if (!selector || sensitive(element)) return;
    if (element instanceof HTMLSelectElement) send({ action: 'select', selector, value: element.value, healHint: healHintFor(element) });
    else if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) send({ action: 'check', selector, healHint: healHintFor(element) });
  }, true);
  document.addEventListener('blur', (event) => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || sensitive(element)) return;
    const selector = selectorFor(element);
    if (selector && element.value) send({ action: 'fill', selector, value: element.value, healHint: healHintFor(element) });
  }, true);
})();`;
