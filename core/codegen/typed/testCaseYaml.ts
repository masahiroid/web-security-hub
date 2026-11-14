import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse, stringify } from 'yaml';
import { generatePlaywrightCode } from './playwright';
import type { CodegenCase, CodegenForm, CodegenLogin, FormCodegenItem, PageSnapshot } from './playwright';

/** Reads a site's runner settings; injected so this module stays independent of how sites are stored. */
export interface TestCaseYamlPorts {
  buildRunnerConfig(siteId: string): { readonly runnerConfig: { readonly login?: CodegenLogin | undefined; readonly scenario?: { readonly steps?: unknown } | undefined } };
}
interface TestCaseGroup { readonly url: string; readonly cases?: readonly CodegenCase[] | undefined }

function readJson(file: string, fallback: unknown): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return fallback;
  }
}
function fieldOf(document: unknown, key: string): unknown {
  return document !== null && typeof document === 'object' ? (document as Record<string, unknown>)[key] : undefined;
}
function listOf<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

export function createTestCaseYaml(ports: TestCaseYamlPorts) {
  function resolveRunnerSettings(sessionDir: string): { login?: CodegenLogin | undefined; steps?: unknown } {
    try {
      // sessionDir = sites/<siteId>/.golden-master/<session>
      const siteId = path.basename(path.resolve(sessionDir, '..', '..'));
      const config = ports.buildRunnerConfig(siteId).runnerConfig;
      return { login: config.login, steps: config.scenario?.steps };
    } catch {
      return {};
    }
  }
  return {
    /**
     * Lossless YAML mirror of a session's forms.json + test-cases.json, for a person to hand-edit
     * and regenerate generated.spec.ts from. The JSON shape is kept so that nothing codegen needs
     * (selectors, field constraints, preSteps, assignment kind/rationale) is lost in the round trip.
     */
    writeTestCasesYaml(sessionDir: string): string {
      const forms = readJson(path.join(sessionDir, 'forms.json'), []);
      const testCaseGroups = readJson(path.join(sessionDir, 'test-cases.json'), []);
      const out = path.join(sessionDir, 'test-cases.yaml');
      fs.writeFileSync(out, stringify({ forms, testCaseGroups }), 'utf8');
      return out;
    },
    /**
     * Regenerates generated.spec.ts from test-cases.yaml, edited or not. Page regression blocks come
     * from url-catalog.json; login settings are re-read from the session's owning site.
     */
    regenerateFromYaml(sessionDir: string): string {
      const yamlPath = path.join(sessionDir, 'test-cases.yaml');
      if (!fs.existsSync(yamlPath)) {
        throw new Error(`test-cases.yaml not found — run "YAMLを書き出す" first: ${yamlPath}`);
      }
      const document: unknown = parse(fs.readFileSync(yamlPath, 'utf8'));
      const forms = listOf<CodegenForm>(fieldOf(document, 'forms'));
      const items = listOf<TestCaseGroup>(fieldOf(document, 'testCaseGroups')).flatMap((group): FormCodegenItem[] => {
        const form = forms.find((candidate) => candidate.url === group.url);
        return form ? [{ form, cases: group.cases ?? [], expectations: [] }] : [];
      });
      const catalog = readJson(path.join(sessionDir, 'url-catalog.json'), {});
      const settings = resolveRunnerSettings(sessionDir);
      const code = generatePlaywrightCode(items, {
        login: settings.login,
        scenarioSteps: settings.steps,
        visitedUrls: listOf<string>(fieldOf(catalog, 'visited')),
        visitedPages: listOf<PageSnapshot>(fieldOf(catalog, 'pages')),
      });
      const out = path.join(sessionDir, 'generated.spec.ts');
      fs.writeFileSync(out, code, 'utf8');
      return out;
    },
  };
}
