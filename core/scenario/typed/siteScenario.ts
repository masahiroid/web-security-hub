import { normalizeSteps } from './stepNormalization';
import { asRecord, type EnvValues, type ResolvedScenario, type ScenarioLogin, type SiteStore, type Variables } from './types';
import { interpolateDeep } from './variables';

/** Application service: turns one site's stored scenario into ready-to-execute scenarios. */

export interface SiteScenario {
  targetUrl: unknown;
  scenario: ResolvedScenario;
}

export interface DataDrivenScenario extends SiteScenario {
  row: number;
  variables: Variables;
}

export interface SiteScenarioDeps {
  readonly store: Pick<SiteStore, 'readSiteConfig' | 'readEnvFile'>;
  expandSharedSteps(steps: unknown, siteId: string): unknown[];
  resolveVariables(siteId: string, overrides?: Variables): Variables;
  buildVariableOverridesPerRow(siteId: string, dataSetName: string): Variables[];
}

export interface SiteScenarios {
  resolveScenarioSteps(siteId: string, steps: unknown, variableOverrides?: Variables): unknown[];
  buildSiteScenario(siteId: string): SiteScenario;
  buildDataDrivenScenarios(siteId: string): DataDrivenScenario[];
}

/** Login credentials come from the site's .env (LOGIN_USER / LOGIN_PASS), never from site.config.json. */
export function buildLogin(config: Record<string, unknown>, env: EnvValues): ScenarioLogin | undefined {
  const login = asRecord(config['login']);
  if (!login?.['loginUrl']) return undefined;
  return {
    url: login['loginUrl'],
    usernameSelector: login['usernameSelector'],
    passwordSelector: login['passwordSelector'],
    submitSelector: login['submitSelector'],
    username: env['LOGIN_USER'] || '',
    password: env['LOGIN_PASS'] || '',
  };
}

export function createSiteScenarios(deps: SiteScenarioDeps): SiteScenarios {
  /** Shared steps expanded, then {{VAR}} tokens replaced with standard + secret variables (and overrides). */
  function resolveScenarioSteps(siteId: string, steps: unknown, variableOverrides: Variables = {}): unknown[] {
    const expanded = deps.expandSharedSteps(steps, siteId);
    const vars = deps.resolveVariables(siteId, variableOverrides);
    return interpolateDeep(expanded, vars) as unknown[];
  }

  function load(siteId: string) {
    const config = asRecord(deps.store.readSiteConfig(siteId)) ?? {};
    const login = buildLogin(config, deps.store.readEnvFile(siteId));
    const scenario = asRecord(config['scenario']);
    const steps = normalizeSteps(scenario?.['steps']);
    return { config, login, steps, dataSource: scenario?.['dataSource'] };
  }

  return {
    resolveScenarioSteps,
    buildSiteScenario(siteId) {
      const { config, login, steps } = load(siteId);
      return { targetUrl: config['baseUrl'], scenario: { login, steps: resolveScenarioSteps(siteId, steps) } };
    },
    /** One scenario per row of config.scenario.dataSource; a single scenario when no data source is set. */
    buildDataDrivenScenarios(siteId) {
      const { config, login, steps, dataSource } = load(siteId);
      const rows: Variables[] = dataSource ? deps.buildVariableOverridesPerRow(siteId, dataSource as string) : [{}];
      return rows.map((overrides, index) => ({
        row: index,
        variables: overrides,
        targetUrl: config['baseUrl'],
        scenario: { login, steps: resolveScenarioSteps(siteId, steps, overrides) },
      }));
    },
  };
}
