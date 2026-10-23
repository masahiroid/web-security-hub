import { buildRunnerConfig } from '../../../core/siteConfig';
import { JsonStore } from '../../../core/store/jsonStore';
import { runFormGeneration } from '../../../core/runner/formRunner';
import { writeHtmlReport } from '../../../core/report/htmlReport';
import { writeMarkdownReport } from '../../../core/report/markdownReport';
import { writeTestCasesYaml } from '../../../core/codegen/testCaseYaml';

/** Crawls a saved site, generates its test cases and writes the session's YAML and reports. */
export async function generateSiteTestSession(siteId: string, log: (line: string) => void = () => {}) {
  const { runnerConfig, outputBaseDir, sessionId } = buildRunnerConfig(siteId);
  const store = new JsonStore(outputBaseDir, sessionId);
  const result = await runFormGeneration(runnerConfig, store, log);
  writeTestCasesYaml(store.location);
  writeHtmlReport(store.location);
  writeMarkdownReport(store.location);
  return { ...result, sessionId, reportUrl: `/api/sites/${siteId}/sessions/${sessionId}/report.html`, markdownUrl: `/api/sites/${siteId}/sessions/${sessionId}/report.md` };
}
