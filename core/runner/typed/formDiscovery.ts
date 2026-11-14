import { existsSync, readFileSync } from 'node:fs';
import type { CatalogFormSummary, Log, RunnerForm, UrlCatalog, UrlCatalogPage } from './types';

/** Turns a raw crawl (or a hand-written manual-forms file) into the deduplicated, classified forms to run. */

const CONSENT_TEXT = /(agree|consent|同意|規約)/i;
const AUTH_URL = /(login|signin|sign-in|auth|resetpassword|forgot|password|entry)/;
const CREDENTIAL_TEXT = /login|sign in|signin|password|passcode|email|mail|user|account|auth/;
const LOGIN_SEED_URL = /(login|signin|sign-in|auth)/;
/** Forms with at most this many fields can be treated as a login form. */
const SHORT_FORM_FIELD_LIMIT = 4;

export interface CatalogPageSnapshot {
  readonly url: string;
  readonly title: string;
  readonly markers: readonly string[];
  readonly textHash: string;
}

export interface FormClassification {
  readonly auth: boolean;
  readonly agreementOnly: boolean;
}

/** When a manual forms file is configured and present, it replaces the crawled forms entirely. */
export function loadManualForms(manualFormsPath: string | undefined, crawledForms: RunnerForm[], log: Log): RunnerForm[] {
  if (!manualFormsPath) return crawledForms;
  if (!existsSync(manualFormsPath)) {
    log(`WARNING: manualFormsPath is configured but the file does not exist: ${manualFormsPath}`);
    return crawledForms;
  }
  const manualForms = parseManualForms(JSON.parse(readFileSync(manualFormsPath, 'utf8')) as unknown, manualFormsPath);
  log(`Manual forms loaded: ${manualForms.length} (${manualFormsPath}) — overriding crawler-detected forms (${crawledForms.length})`);
  return manualForms;
}

function parseManualForms(value: unknown, source: string): RunnerForm[] {
  if (!Array.isArray(value)) throw new Error(`manual forms must be a JSON array: ${source}`);
  return value.map((entry: unknown, index) => {
    if (!isRecord(entry) || typeof entry['url'] !== 'string' || !Array.isArray(entry['fields'])) {
      throw new Error(`manual form ${index} needs a url string and a fields array: ${source}`);
    }
    for (const field of entry['fields'] as unknown[]) {
      if (!isRecord(field) || typeof field['selector'] !== 'string' || typeof field['type'] !== 'string') {
        throw new Error(`manual form ${index} has a field without selector/type strings: ${source}`);
      }
    }
    return entry as unknown as RunnerForm;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function dedupeForms(forms: readonly RunnerForm[]): RunnerForm[] {
  const out: RunnerForm[] = [];
  const seen = new Set<string>();
  for (const f of forms) {
    const fieldShape = f.fields
      .map((field) => `${field.selector}:${field.type}:${field.name ?? ''}`)
      .sort()
      .join('|');
    const key = `${f.url}::${f.formSelector}::${f.submitSelector ?? ''}::${fieldShape}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function isAgreementOnlyForm(form: RunnerForm): boolean {
  if (form.fields.length !== 1) return false;
  const f = form.fields[0];
  if (!f || f.type !== 'checkbox') return false;
  const text = [f.name, f.id, f.label, f.placeholder].filter(Boolean).join(' ').toLowerCase();
  return CONSENT_TEXT.test(text);
}

/** Auth/login forms and bare agreement checkboxes are left out of value testing. */
export function classifyForm(form: RunnerForm): FormClassification {
  const p = form.url.toLowerCase();
  const hasPasswordField = form.fields.some((field) => field.type === 'password');
  const hasCredentialField = form.fields.some((field) => {
    const text = [field.name, field.id, field.label, field.placeholder, field.semantic].filter(Boolean).join(' ').toLowerCase();
    return CREDENTIAL_TEXT.test(text);
  });
  const shortForm = form.fields.length <= SHORT_FORM_FIELD_LIMIT;

  if (AUTH_URL.test(p)) return { auth: true, agreementOnly: false };
  return { auth: shortForm && hasPasswordField && hasCredentialField, agreementOnly: isAgreementOnlyForm(form) };
}

export function shouldPrimeLogin(cfg: { readonly url?: string | undefined; readonly login?: { readonly loginUrl?: string | undefined } | undefined }): boolean {
  const seed = (cfg.url || '').toLowerCase();
  const loginUrl = (cfg.login?.loginUrl || '').toLowerCase();
  if (loginUrl && seed === loginUrl) return true;
  return LOGIN_SEED_URL.test(seed);
}

function normalizeCatalogUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

function summarizeCatalogForms(forms: readonly RunnerForm[]): CatalogFormSummary[] {
  return forms.map((f) => ({
    formSelector: f.formSelector,
    submitSelector: f.submitSelector,
    fieldCount: f.fields.length,
    requiredCount: f.fields.filter((field) => !!field.constraints?.required).length,
  }));
}

export function buildUrlCatalog(seedUrl: string, visited: readonly string[], pageSnapshots: readonly CatalogPageSnapshot[], forms: readonly RunnerForm[]): UrlCatalog {
  const byUrl = new Map<string, RunnerForm[]>();
  for (const f of forms) {
    const key = normalizeCatalogUrl(f.url);
    const list = byUrl.get(key) ?? [];
    list.push(f);
    byUrl.set(key, list);
  }

  const pagesByUrl = new Map<string, UrlCatalogPage>();
  for (const snap of pageSnapshots) {
    const key = normalizeCatalogUrl(snap.url);
    pagesByUrl.set(key, { url: snap.url, title: snap.title, markers: snap.markers, textHash: snap.textHash, forms: summarizeCatalogForms(byUrl.get(key) ?? []) });
  }

  for (const u of visited) {
    const key = normalizeCatalogUrl(u);
    if (!pagesByUrl.has(key)) {
      pagesByUrl.set(key, { url: u, title: '', markers: [], textHash: '', forms: summarizeCatalogForms(byUrl.get(key) ?? []) });
    }
  }

  const pages = Array.from(pagesByUrl.values()).sort((a, b) => a.url.localeCompare(b.url));
  const normalizedVisited = Array.from(new Set(visited.map(normalizeCatalogUrl))).sort();
  return { seedUrl, generatedAt: new Date().toISOString(), visited: normalizedVisited, pages };
}

export function uniquePageCaseCount(snapshots: readonly { readonly url: string }[], fallbackVisited: readonly string[]): number {
  const urls = snapshots.length ? snapshots.map((s) => s.url) : fallbackVisited;
  return new Set(
    urls.map((u) => {
      try {
        const parsed = new URL(u);
        return parsed.pathname + parsed.search;
      } catch {
        return u;
      }
    }),
  ).size;
}
