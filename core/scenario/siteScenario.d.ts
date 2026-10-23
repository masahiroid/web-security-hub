export interface SiteScenario { readonly targetUrl?: string | undefined; readonly scenario?: unknown }
export function normalizeStoredScenario(scenario: unknown): unknown;
export function buildSiteScenario(siteId: string | undefined): SiteScenario;
