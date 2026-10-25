'use strict';

const RESOLVE_TIMEOUT_MS = 4_000;
const FALLBACK_TIMEOUT_MS = 1_500;
const MAX_SCAN_CANDIDATES = 300;
const MATCH_THRESHOLD = 3;

/**
 * Reads a plain-object descriptor of an element from the live page — the
 * "heal hint" saved alongside a recorded step so a later run can still find
 * the element if its primary selector stops matching (UI markup changed,
 * an id got regenerated, etc). Contains no field values, only structural
 * identity, so it's safe to keep even for steps on sensitive fields.
 */
async function describeHandle(handle) {
  return handle.evaluate((el) => {
    const attr = (name) => el.getAttribute(name) || undefined;
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60) || undefined;
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
      classes: el.className && typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3) : undefined,
    };
  });
}

/** Pure function: ranks candidate selectors for a descriptor, most-stable first. Never touches the page. */
function candidatesFromDescriptor(descriptor) {
  if (!descriptor || !descriptor.tag) return [];
  const out = [];
  const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (descriptor.id) out.push(`#${cssEscapeId(descriptor.id)}`);
  if (descriptor.dataTestId) out.push(`[data-testid="${esc(descriptor.dataTestId)}"], [data-test="${esc(descriptor.dataTestId)}"]`);
  if (descriptor.name) out.push(`${descriptor.tag}[name="${esc(descriptor.name)}"]`);
  if (descriptor.ariaLabel) out.push(`[aria-label="${esc(descriptor.ariaLabel)}"]`);
  if (descriptor.role && descriptor.text) out.push(`role=${descriptor.role}[name="${esc(descriptor.text)}"]`);
  if (descriptor.placeholder) out.push(`${descriptor.tag}[placeholder="${esc(descriptor.placeholder)}"]`);
  if (descriptor.text && descriptor.text.length <= 40) out.push(`text="${esc(descriptor.text)}"`);
  if (descriptor.classes?.length) out.push(`${descriptor.tag}.${descriptor.classes.map((c) => cssEscapeId(c)).join('.')}`);
  return out;
}

function cssEscapeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

/** Cheap structural similarity score between a heal hint and a live element's descriptor. Not exact-match — a ranking signal. */
function similarityScore(hint, candidate) {
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

/** Scans same-tag elements on the current page for the closest match to a heal hint. Returns its index among same-tag elements, or undefined. */
async function findBestMatch(page, hint) {
  if (!hint?.tag) return undefined;
  const handles = await page.locator(hint.tag).all();
  let bestIndex;
  let bestScore = 0;
  for (let i = 0; i < Math.min(handles.length, MAX_SCAN_CANDIDATES); i++) {
    const descriptor = await describeHandle(handles[i]).catch(() => undefined);
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

/**
 * Resolves a step's locator with self-healing: try the recorded selector
 * first, then (if a healHint was saved) each derived fallback candidate,
 * then a similarity scan of the live page. Whichever succeeds is returned
 * along with whether healing was needed, so callers can surface it instead
 * of silently swapping selectors underneath the user.
 */
async function resolveWithHealing(page, step) {
  const primary = page.locator(step.selector);
  try {
    await primary.first().waitFor({ state: 'attached', timeout: RESOLVE_TIMEOUT_MS });
    return { locator: primary, usedSelector: step.selector, healed: false };
  } catch (primaryError) {
    if (!step.healHint) throw primaryError;

    for (const candidate of candidatesFromDescriptor(step.healHint)) {
      if (candidate === step.selector) continue;
      try {
        const loc = page.locator(candidate);
        await loc.first().waitFor({ state: 'attached', timeout: FALLBACK_TIMEOUT_MS });
        return { locator: loc, usedSelector: candidate, healed: true, strategy: 'fallback-selector' };
      } catch {
        // try the next candidate
      }
    }

    const match = await findBestMatch(page, step.healHint).catch(() => undefined);
    if (match) {
      return {
        locator: page.locator(step.healHint.tag).nth(match.index),
        usedSelector: `${step.healHint.tag} (similarity match, score ${match.score})`,
        healed: true,
        strategy: 'similarity-scan',
      };
    }

    throw primaryError;
  }
}

module.exports = { describeHandle, candidatesFromDescriptor, similarityScore, findBestMatch, resolveWithHealing };
