import type { ElementHandle, Locator, Page } from 'playwright';
import type { HealHint } from './types';

/**
 * Self-healing locator resolution: try the recorded selector, then selectors derived from the
 * saved heal hint, then a similarity scan of same-tag elements. Ranking rules are pure.
 */

export const RESOLVE_TIMEOUT_MS = 4_000;
export const FALLBACK_TIMEOUT_MS = 1_500;
/** Same-tag elements inspected by the similarity scan. */
export const MAX_SCAN_CANDIDATES = 300;
/** Minimum similarity score accepted as a heal. */
export const MATCH_THRESHOLD = 3;
const HINT_TEXT_LENGTH = 60;
const MAX_TEXT_SELECTOR_LENGTH = 40;
const HINT_CLASSES = 3;

export type HealStrategy = 'fallback-selector' | 'similarity-scan';

export interface ResolvedLocator {
  locator: Locator;
  usedSelector: string;
  healed: boolean;
  strategy?: HealStrategy;
}

export interface LocatableStep {
  readonly selector: string;
  readonly healHint?: HealHint | undefined;
}

/** Reads the structural descriptor of a live element (no field values). */
export async function describeHandle(handle: Pick<ElementHandle | Locator, 'evaluate'>): Promise<HealHint> {
  return (handle as Locator).evaluate(
    (el: Element, limits: { text: number; classes: number }) => {
      const attr = (name: string): string | undefined => el.getAttribute(name) || undefined;
      const html = el as HTMLElement;
      const text = (html.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, limits.text) || undefined;
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        dataTestId: attr('data-testid') || attr('data-test'),
        name: attr('name'),
        type: attr('type'),
        role: attr('role'),
        ariaLabel: attr('aria-label'),
        placeholder: attr('placeholder'),
        text,
        classes: el.className && typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, limits.classes) : undefined,
      } as HealHint;
    },
    { text: HINT_TEXT_LENGTH, classes: HINT_CLASSES },
  );
}

function cssEscapeId(value: unknown): string {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

const esc = (v: unknown): string => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Candidate selectors for a descriptor, most stable first. */
export function candidatesFromDescriptor(descriptor: HealHint | undefined): string[] {
  if (!descriptor || !descriptor.tag) return [];
  const d = descriptor;
  const out: string[] = [];
  if (d.id) out.push(`#${cssEscapeId(d.id)}`);
  if (d.dataTestId) out.push(`[data-testid="${esc(d.dataTestId)}"], [data-test="${esc(d.dataTestId)}"]`);
  if (d.name) out.push(`${d.tag}[name="${esc(d.name)}"]`);
  if (d.ariaLabel) out.push(`[aria-label="${esc(d.ariaLabel)}"]`);
  if (d.role && d.text) out.push(`role=${d.role}[name="${esc(d.text)}"]`);
  if (d.placeholder) out.push(`${d.tag}[placeholder="${esc(d.placeholder)}"]`);
  if (d.text && d.text.length <= MAX_TEXT_SELECTOR_LENGTH) out.push(`text="${esc(d.text)}"`);
  if (d.classes?.length) out.push(`${d.tag}.${d.classes.map((c) => cssEscapeId(c)).join('.')}`);
  return out;
}

/** Structural similarity, a ranking signal rather than an exact match. */
export function similarityScore(hint: HealHint, candidate: HealHint): number {
  let score = 0;
  if (hint.tag && hint.tag === candidate.tag) score += 1;
  if (hint.type && hint.type === candidate.type) score += 1;
  if (hint.name && hint.name === candidate.name) score += 2;
  if (hint.role && hint.role === candidate.role) score += 1;
  if (hint.ariaLabel && hint.ariaLabel === candidate.ariaLabel) score += 2;
  if (hint.placeholder && hint.placeholder === candidate.placeholder) score += 2;
  if (hint.text && candidate.text) {
    if (hint.text === candidate.text) score += 3;
    else if (candidate.text.includes(hint.text) || hint.text.includes(candidate.text)) score += 1;
  }
  return score;
}

/** Index (among same-tag elements) of the closest match to a heal hint, or undefined. */
export async function findBestMatch(page: Page, hint: HealHint | undefined): Promise<{ index: number; score: number } | undefined> {
  if (!hint?.tag) return undefined;
  const handles = await page.locator(hint.tag).all();
  let bestIndex: number | undefined;
  let bestScore = 0;
  for (const [i, handle] of handles.slice(0, MAX_SCAN_CANDIDATES).entries()) {
    const descriptor = await describeHandle(handle).catch(() => undefined);
    if (!descriptor) continue;
    const score = similarityScore(hint, descriptor);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  if (bestIndex === undefined || bestScore < MATCH_THRESHOLD) return undefined;
  return { index: bestIndex, score: bestScore };
}

/** Whether healing was needed is returned so callers can show it instead of silently swapping selectors. */
export async function resolveWithHealing(page: Page, step: LocatableStep): Promise<ResolvedLocator> {
  const primary = page.locator(step.selector);
  try {
    await primary.first().waitFor({ state: 'attached', timeout: RESOLVE_TIMEOUT_MS });
    return { locator: primary, usedSelector: step.selector, healed: false };
  } catch (primaryError) {
    const hint = step.healHint;
    if (!hint) throw primaryError;

    for (const candidate of candidatesFromDescriptor(hint)) {
      if (candidate === step.selector) continue;
      try {
        const loc = page.locator(candidate);
        await loc.first().waitFor({ state: 'attached', timeout: FALLBACK_TIMEOUT_MS });
        return { locator: loc, usedSelector: candidate, healed: true, strategy: 'fallback-selector' };
      } catch {
        // try the next candidate
      }
    }

    const match = await findBestMatch(page, hint).catch(() => undefined);
    if (match && hint.tag) {
      return {
        locator: page.locator(hint.tag).nth(match.index),
        usedSelector: `${hint.tag} (similarity match, score ${match.score})`,
        healed: true,
        strategy: 'similarity-scan',
      };
    }

    throw primaryError;
  }
}
