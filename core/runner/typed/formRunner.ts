import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { generatePlaywrightCode } from '../../codegen/typed/playwright';
import { BrowserSession, type BrowserOptions } from '../../crawler/typed/browser';
import { crawlForForms } from '../../crawler/typed/crawler';
import { buildUrlCatalog, classifyForm, dedupeForms, loadManualForms, uniquePageCaseCount } from './formDiscovery';
import type { FormCodegenItem } from '../../codegen/typed/playwright';
import type { ProcessForm, ProcessSettings, RunSummary } from './formProcessor';
import type { Log, RunnerStore, SemanticProvider } from './types';

/** The crawler stays on the seed URL's origin. */
const SAME_ORIGIN_ONLY = true;
const GENERATED_SPEC_FILE = 'generated.spec.ts';

export interface RunnerScenario {
  readonly login?: { readonly url?: string | undefined } | undefined;
  readonly steps?: readonly unknown[] | undefined;
}

export interface ScenarioOutcome {
  readonly healEvents: readonly unknown[];
  readonly aiAssertions: readonly unknown[];
}

/** Scenario and Rule Spec ports (implemented by core/security and core/spec), plus the form pipeline. */
export interface FormRunnerDependencies {
  runScenario(page: Page, targetUrl: string, scenario: RunnerScenario, log: Log, siteId: string, ai: unknown): Promise<ScenarioOutcome>;
  loadRuleSpecs(dir: string): { readonly specs: readonly unknown[]; readonly warnings: readonly string[] };
  processForm: ProcessForm;
}

export interface FormGenerationConfig extends ProcessSettings {
  readonly siteId: string;
  readonly url: string;
  readonly maxDepth: number;
  readonly maxPages: number;
  readonly headful: boolean;
  readonly engine?: BrowserOptions['engine'];
  readonly device?: BrowserOptions['device'];
  readonly clientCert?: BrowserOptions['clientCert'];
  readonly storageStatePath?: BrowserOptions['storageStatePath'];
  readonly httpCredentials?: BrowserOptions['httpCredentials'];
  readonly ruleSpecDir?: string | undefined;
  readonly manualFormsPath?: string | undefined;
  readonly scenario?: RunnerScenario | undefined;
  readonly ai?: unknown;
}

export interface FormGenerationSummary {
  readonly codePath: string;
  readonly formCount: number;
  readonly caseCount: number;
  readonly executedCaseCount: number;
  readonly okCaseCount: number;
  readonly ngCaseCount: number;
  readonly runSummaries: RunSummary[];
  readonly scenarioHealEvents: readonly unknown[];
  readonly scenarioAiAssertions: readonly unknown[];
}

/** Rule-based field meanings only; no model is called during form generation. */
const ruleBasedProvider: SemanticProvider = { name: 'rule-based', inferFieldSemantics: async () => [] };

export function createFormRunner(deps: FormRunnerDependencies) {
  /** Optional scenario -> crawl -> per-form pipeline -> Playwright spec written to the output directory. */
  return async function runFormGeneration(cfg: FormGenerationConfig, store: RunnerStore, log: Log): Promise<FormGenerationSummary> {
    const screenshots = join(cfg.outputDir, 'screenshots');
    mkdirSync(screenshots, { recursive: true });
    const session = new BrowserSession({
      headful: cfg.headful,
      engine: cfg.engine,
      device: cfg.device,
      clientCert: cfg.clientCert,
      storageStatePath: cfg.storageStatePath,
      httpCredentials: cfg.httpCredentials,
      dialogAction: 'accept',
      onDialog: log,
    });
    const page = await session.start();
    try {
      const loaded = cfg.ruleSpecDir ? deps.loadRuleSpecs(cfg.ruleSpecDir) : { specs: [], warnings: [] };
      loaded.warnings.forEach((w) => log(`spec warning: ${w}`));
      log(`巡回開始: depth=${cfg.maxDepth}, pages=${cfg.maxPages}`);
      let seedUrl = cfg.url;
      let scenarioHealEvents: readonly unknown[] = [];
      let scenarioAiAssertions: readonly unknown[] = [];
      if (cfg.scenario?.login?.url || cfg.scenario?.steps?.length) {
        const scenarioResult = await deps.runScenario(page, cfg.url, cfg.scenario, log, cfg.siteId, cfg.ai);
        scenarioHealEvents = scenarioResult.healEvents;
        scenarioAiAssertions = scenarioResult.aiAssertions;
        seedUrl = page.url();
        log(`シナリオ完了: ${seedUrl}`);
        if (scenarioHealEvents.length) log(`シナリオ内で${scenarioHealEvents.length}件のセレクタを自動修復しました`);
        if (scenarioAiAssertions.length) log(`シナリオ内で${scenarioAiAssertions.length}件のAIアサーションを実行しました`);
      }
      const { forms: crawled, visited, pageSnapshots } = await crawlForForms(
        page,
        seedUrl,
        { maxDepth: cfg.maxDepth, maxPages: cfg.maxPages, sameOriginOnly: SAME_ORIGIN_ONLY, login: cfg.login, screenshotDir: screenshots },
        log,
      );
      const forms = dedupeForms(loadManualForms(cfg.manualFormsPath, crawled, log));
      for (const form of forms) await store.saveForm(form);
      await store.saveUrlCatalog(buildUrlCatalog(cfg.url, visited, pageSnapshots, forms));
      const targets = forms.filter((form) => {
        const status = classifyForm(form);
        return !status.auth && !status.agreementOnly;
      });

      const items: FormCodegenItem[] = [];
      const runSummaries: RunSummary[] = [];
      let executedCaseCount = 0;
      let okCaseCount = 0;
      let ngCaseCount = 0;
      for (const [i, target] of targets.entries()) {
        log(`--- form ${i + 1}/${targets.length}: ${target.url} (${target.fields.length} fields) ---`);
        const processed = await deps.processForm(target, loaded.specs, ruleBasedProvider, cfg, session, store, log);
        items.push(processed.item);
        executedCaseCount += processed.execution.executed;
        okCaseCount += processed.execution.ok;
        ngCaseCount += processed.execution.ng;
        runSummaries.push(...processed.execution.summaries);
      }

      const codePath = join(cfg.outputDir, GENERATED_SPEC_FILE);
      const code = generatePlaywrightCode(items, { login: cfg.login, scenarioSteps: cfg.scenario?.steps, visitedUrls: visited, visitedPages: pageSnapshots });
      writeFileSync(codePath, code, 'utf8');
      const formCases = items.reduce((n, item) => n + item.cases.length, 0);
      return {
        codePath,
        formCount: items.length,
        caseCount: formCases + uniquePageCaseCount(pageSnapshots, visited),
        executedCaseCount,
        okCaseCount,
        ngCaseCount,
        runSummaries,
        scenarioHealEvents,
        scenarioAiAssertions,
      };
    } finally {
      await session.stop();
    }
  };
}
