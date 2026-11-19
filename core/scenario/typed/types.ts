/** Shared shapes for site scenarios: portable steps saved in site.config.json and replayed by Playwright. */

/** Structural identity of an element (never field values), used to heal a selector that stopped matching. */
export interface HealHint {
  tag?: string;
  id?: string;
  dataTestId?: string;
  name?: string;
  type?: string;
  role?: string;
  ariaLabel?: string;
  placeholder?: string;
  text?: string;
  classes?: string[];
}

/** Exactly one of exists / visible / equals is set after normalization. */
export interface StepCondition {
  selector: string;
  exists?: boolean;
  visible?: boolean;
  equals?: string;
}

export type LocatorAction = 'click' | 'fill' | 'check' | 'uncheck' | 'select' | 'setFile' | 'download';

export type ScenarioStep =
  | { action: 'useSharedStep'; name: string }
  | { action: 'goto'; url: string }
  | { action: 'wait'; value: number }
  | { action: 'back' | 'forward' | 'reload' }
  | { action: 'aiAssert'; description: string }
  | { action: 'setFile'; selector: string; path: string; healHint?: HealHint }
  | { action: 'download'; selector: string; saveAs?: string; healHint?: HealHint }
  | { action: 'branch'; condition: StepCondition; then: ScenarioStep[]; else: ScenarioStep[] }
  | { action: 'loop'; times: number; steps: ScenarioStep[] }
  | { action: 'click' | 'check' | 'uncheck'; selector: string; healHint?: HealHint }
  | { action: 'fill' | 'select'; selector: string; value: string; healHint?: HealHint };

export interface StoredScenario {
  steps: ScenarioStep[];
  dataSource: string | undefined;
}

export interface ScenarioLogin {
  url: unknown;
  usernameSelector: unknown;
  passwordSelector: unknown;
  submitSelector: unknown;
  username: string;
  password: string;
}

export interface ResolvedScenario {
  login: ScenarioLogin | undefined;
  steps: unknown[];
}

export type Variables = Readonly<Record<string, unknown>>;
export type EnvValues = Readonly<Record<string, string>>;

/** Port onto site storage (core/siteConfig.js). Config content is external data and validated where read. */
export interface SiteStore {
  siteDir(siteId: string): string;
  readSiteConfig(siteId: string): unknown;
  readEnvFile(siteId: string): EnvValues;
}

/** Narrowing helper for external JSON. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
