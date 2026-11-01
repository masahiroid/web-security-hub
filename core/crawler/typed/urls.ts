/** URL helpers shared by the crawler and the explorer. */

/** URL without its fragment; unparsable input is returned unchanged. */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

/** URL href without its fragment, or undefined when the input is not a URL. */
export function tryNormalizeUrl(raw: string): string | undefined {
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return undefined;
  }
}

/** Origin of a URL, or the empty string when it cannot be parsed. */
export function originOrEmpty(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** Origin of a URL, or undefined when it cannot be parsed. */
export function tryOrigin(raw: string): string | undefined {
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}

/** Two URLs are the same page when they differ at most in their fragment. */
export function sameUrl(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    a.hash = '';
    b.hash = '';
    return a.toString() === b.toString();
  } catch {
    return left === right;
  }
}
