import type { Page } from 'playwright';

export interface FieldConstraints {
  source: 'html';
  required?: true;
  maxLength?: number;
  minLength?: number;
  min?: number;
  max?: number;
  step?: number;
  pattern?: string;
}

export interface FormField {
  selector: string;
  tag: string;
  type: string;
  name?: string | undefined;
  id?: string | undefined;
  label?: string | undefined;
  placeholder?: string | undefined;
  constraints: FieldConstraints;
  options?: string[] | undefined;
  optionLabels?: string[] | undefined;
  semantic?: string | undefined;
}

export interface ScannedForm {
  url: string;
  formSelector: string;
  submitSelector?: string | undefined;
  fields: FormField[];
}

export interface PageNavigation {
  links: string[];
  clickableCount: number;
  clickSelectors: string[];
}

interface RawForm {
  formSelector: string;
  submitSelector: string | undefined;
  fields: FormField[];
}

/** Scans the first (or given index) form on the page. */
export async function scanForm(page: Page, formIndex = 0): Promise<ScannedForm | null> {
  const forms = await scanForms(page);
  if (!forms.length) return null;
  return forms[Math.min(formIndex, forms.length - 1)] ?? null;
}

/** Scans all forms on the page and returns their fields/constraints/stable selectors. */
export async function scanForms(page: Page): Promise<ScannedForm[]> {
  const forms: RawForm[] = await page.evaluate(extractFormsInPage);
  const url = page.url();
  return forms
    .map(form => ({
      url,
      formSelector: form.formSelector,
      submitSelector: form.submitSelector,
      fields: form.fields,
    }))
    .filter(form => form.fields.length > 0);
}

/** Collects link/click navigation candidates for the crawler to follow. Runs inside the browser. */
export async function collectNavigation(page: Page): Promise<PageNavigation> {
  return page.evaluate((): PageNavigation => {
    const toAbs = (url: string): string => {
      try {
        return new URL(url, location.href).toString();
      } catch {
        return '';
      }
    };
    const cssEscape = (value: string): string => value.replace(/["\\]/g, '\\$&');
    const stableSelector = (el: Element): string => {
      if (el.id) return `#${cssEscape(el.id)}`;
      const name = el.getAttribute('name');
      const tag = el.tagName.toLowerCase();
      if (name) return `${tag}[name="${cssEscape(name)}"]`;
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur.tagName.toLowerCase() !== 'html') {
        const parentEl: Element | null = cur.parentElement;
        const t = cur.tagName.toLowerCase();
        if (!parentEl) {
          parts.unshift(t);
          break;
        }
        const currentTag = cur.tagName;
        const sameTag = Array.from(parentEl.children).filter(c => c.tagName === currentTag);
        const idx = sameTag.indexOf(cur) + 1;
        parts.unshift(`${t}:nth-of-type(${idx})`);
        cur = parentEl;
      }
      return parts.join(' > ');
    };

    const hrefs = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .map(a => a.href)
      .filter(h => /^https?:/i.test(h));
    const actionLinks = Array.from(document.querySelectorAll('[formaction], [data-href], [data-url], [onclick]'))
      .map(el => {
        const formaction = el.getAttribute('formaction');
        if (formaction) return toAbs(formaction);
        const dataHref = el.getAttribute('data-href') || el.getAttribute('data-url');
        if (dataHref) return toAbs(dataHref);
        const onclick = el.getAttribute('onclick') || '';
        const match = onclick.match(/(location\.(href|assign|replace)\s*=\s*|location\.(assign|replace)\s*\()\s*['"]([^'"]+)['"]/i);
        return match?.[4] ? toAbs(match[4]) : '';
      })
      .filter(h => !!h && /^https?:/i.test(h));
    const clickable = document.querySelectorAll('button, [role="button"], [onclick], input[type="submit"], input[type="button"]').length;

    const clickSelectors = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, input[type="submit"], input[type="button"], [role="button"][onclick], [data-href], [data-url], [formaction], form button, form input[type="submit"], form input[type="button"]',
      ),
    )
      .filter(el => {
        if (el.closest('header, nav, footer, aside')) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return false;
        const href = (el as Partial<HTMLAnchorElement>).href;
        if (href) {
          try {
            const u = new URL(href, location.href);
            if (!/^https?:$/i.test(u.protocol)) return false;
            if (el.tagName.toLowerCase() === 'a' && !/\/mypage\b/i.test(u.pathname)) return false;
            if (/logout|signout|\/exit\b/i.test(u.pathname)) return false;
          } catch {
            return false;
          }
        }
        const text = ((el.textContent || '') + ' ' + ((el as Partial<HTMLInputElement>).value || '')).trim();
        if (!text) return true;
        if (/(削除|退会|解約|キャンセル|停止|ログアウト|logout|destroy|delete)/i.test(text)) return false;
        return true;
      })
      .slice(0, 12)
      .map(el => stableSelector(el));

    return {
      links: Array.from(new Set([...hrefs, ...actionLinks])),
      clickableCount: clickable,
      clickSelectors: Array.from(new Set(clickSelectors)),
    };
  });
}

/** Executed inside the browser context; must be self-contained (no outer closures). */
function extractFormsInPage(): RawForm[] {
  const cssEscape = (value: string): string => value.replace(/["\\]/g, '\\$&');

  function stableSelector(el: Element): string {
    const dataAttr = Array.from(el.attributes).find(a => a.name.startsWith('data-'));
    if (dataAttr && dataAttr.value) return `[${dataAttr.name}="${cssEscape(dataAttr.value)}"]`;
    if (el.id) return `#${cssEscape(el.id)}`;
    const name = el.getAttribute('name');
    const tag = el.tagName.toLowerCase();
    if (name) return `${tag}[name="${cssEscape(name)}"]`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur.tagName.toLowerCase() !== 'html') {
      const node: Element = cur;
      const t = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;
      if (!parent) {
        parts.unshift(t);
        break;
      }
      const sameTag = Array.from(parent.children).filter(c => c.tagName === node.tagName);
      const idx = sameTag.indexOf(node) + 1;
      parts.unshift(`${t}:nth-of-type(${idx})`);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function labelFor(el: Element): string | undefined {
    const id = el.getAttribute('id');
    if (id) {
      const lbl = document.querySelector(`label[for="${id.replace(/["\\]/g, '\\$&')}"]`);
      if (lbl?.textContent) return lbl.textContent.trim();
    }
    const name = el.getAttribute('name');
    if (name) {
      const lbl = document.querySelector(`label[for="${name.replace(/["\\]/g, '\\$&')}"]`);
      if (lbl?.textContent) return lbl.textContent.trim();
    }
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    const wrap = el.closest('label');
    if (wrap?.textContent) return wrap.textContent.trim();
    return undefined;
  }

  function isVisible(el: Element): boolean {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function isInMainContent(el: Element): boolean {
    const blocked = el.closest('header, nav, footer, aside, dialog');
    if (blocked) return false;
    return !!el.closest('main, [role="main"], article, section, body');
  }

  function isMarkedRequiredByDtLabel(el: Element): boolean {
    const dd = el.closest('dd');
    const dt = dd?.previousElementSibling;
    if (!dt || dt.tagName.toLowerCase() !== 'dt') return false;
    if (/must|required|essential/i.test(dt.className || '')) return true;
    return /必須/.test(dt.textContent || '');
  }

  function fieldInfo(el: Element): FormField | undefined {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || (tag === 'select' ? 'select' : 'text')).toLowerCase();

    if (['submit', 'button', 'image', 'reset', 'hidden'].includes(type)) return undefined;

    const constraints: FieldConstraints = { source: 'html' };
    if (el.hasAttribute('required') || el.hasAttribute('aria-required') || isMarkedRequiredByDtLabel(el)) {
      constraints.required = true;
    }
    const maxLength = el.getAttribute('maxlength');
    if (maxLength) constraints.maxLength = Number(maxLength);
    const minLength = el.getAttribute('minlength');
    if (minLength) constraints.minLength = Number(minLength);
    const min = el.getAttribute('min');
    if (min !== null && min !== '') constraints.min = Number(min);
    const max = el.getAttribute('max');
    if (max !== null && max !== '') constraints.max = Number(max);
    const step = el.getAttribute('step');
    if (step) constraints.step = Number(step);
    const pattern = el.getAttribute('pattern');
    if (pattern) constraints.pattern = pattern;

    let options: string[] | undefined;
    let optionLabels: string[] | undefined;
    if (el instanceof HTMLSelectElement) {
      const opts = Array.from(el.options);
      options = opts.map(o => o.value);
      optionLabels = opts.map(o => (o.textContent || '').trim());
    } else if (type === 'radio' || type === 'checkbox') {
      options = ['on'];
    }

    return {
      selector: stableSelector(el),
      tag,
      type,
      name: el.getAttribute('name') || undefined,
      id: el.getAttribute('id') || undefined,
      label: labelFor(el),
      placeholder: el.getAttribute('placeholder') || undefined,
      constraints,
      options,
      optionLabels,
    };
  }

  const result: RawForm[] = [];

  const forms = Array.from(document.querySelectorAll('form'));
  for (const form of forms) {
    const formSelector = stableSelector(form);
    const controls = Array.from(form.querySelectorAll('input, select, textarea'));

    const fields: FormField[] = [];
    let submitSelector: string | undefined;

    for (const el of controls) {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if ((type === 'submit' || type === 'image') && !submitSelector) submitSelector = stableSelector(el);
      if (!isVisible(el)) continue;
      const info = fieldInfo(el);
      if (info) fields.push(info);
    }

    if (!submitSelector) {
      const btn = form.querySelector('button');
      if (btn) submitSelector = stableSelector(btn);
    }

    if (!submitSelector) {
      const jsSubmitAnchor = Array.from(form.querySelectorAll('a[href^="javascript:"]')).find(a =>
        /\.submit\s*\(\s*\)/.test(a.getAttribute('href') || ''),
      );
      if (jsSubmitAnchor) submitSelector = stableSelector(jsSubmitAnchor);
    }

    result.push({ formSelector, submitSelector, fields });
  }

  const standaloneControls = Array.from(document.querySelectorAll('input, select, textarea')).filter(
    el => !el.closest('form') && isVisible(el) && isInMainContent(el),
  );

  const standaloneFields = standaloneControls.map(el => fieldInfo(el)).filter((field): field is FormField => !!field);

  if (standaloneFields.length) {
    const mainRoot = document.querySelector('main, [role="main"], article, section') || document.body;
    const submitButton = Array.from(
      mainRoot.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]'),
    ).find(el => isVisible(el));

    result.push({
      formSelector: stableSelector(mainRoot),
      submitSelector: submitButton ? stableSelector(submitButton) : undefined,
      fields: standaloneFields,
    });
  }

  return result;
}
