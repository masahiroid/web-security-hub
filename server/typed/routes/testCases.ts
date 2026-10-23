import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { regenerateFromYaml, writeTestCasesYaml } from '../../../core/codegen/testCaseYaml';
import { DEFAULTS, HTTP_STATUS } from '../config';
import { bodyOf, isRecord, messageOf, param } from '../lib/http';
import { sessionDirFor } from '../lib/sessionPaths';
import { apiRateLimit } from '../lib/rateLimit';

function readYamlDocument(directory: string): { yamlPath: string; document: Record<string, unknown> } {
  const yamlPath = path.join(directory, DEFAULTS.testCasesYaml);
  if (!fs.existsSync(yamlPath)) writeTestCasesYaml(directory);
  const parsed: unknown = YAML.parse(fs.readFileSync(yamlPath, 'utf8'));
  return { yamlPath, document: isRecord(parsed) ? parsed : {} };
}
/** The table editor's data source and the YAML export and regeneration it relies on. */
export function createTestCasesRoutes(): express.Router {
  const router = express.Router();
  router.use(apiRateLimit());
  const session = (request: express.Request) => ({ siteId: param(request, 'id'), sessionId: param(request, 'sessionId') });
  // Writes test-cases.yaml from the session's current forms and cases.
  router.post('/sites/:id/sessions/:sessionId/yaml/export', (request, response) => {
    const { siteId, sessionId } = session(request);
    try {
      writeTestCasesYaml(sessionDirFor(siteId, sessionId));
      response.json({ yamlUrl: `/api/sites/${siteId}/sessions/${sessionId}/test-cases.yaml` });
    } catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  // Regenerates the test code from the (possibly hand-edited) YAML.
  router.post('/sites/:id/sessions/:sessionId/yaml/regenerate', (request, response) => {
    const { siteId, sessionId } = session(request);
    try { regenerateFromYaml(sessionDirFor(siteId, sessionId)); response.json({ ok: true }); }
    catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  // The case list; the YAML is exported from the session's JSON on first read.
  router.get('/sites/:id/sessions/:sessionId/test-cases', (request, response) => {
    const { siteId, sessionId } = session(request);
    try { response.json({ testCaseGroups: readYamlDocument(sessionDirFor(siteId, sessionId)).document.testCaseGroups ?? [] }); }
    catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  // Overwrites the case groups (forms untouched) and regenerates the test code so the edit takes effect at once.
  router.put('/sites/:id/sessions/:sessionId/test-cases', (request, response) => {
    const { siteId, sessionId } = session(request);
    try {
      const directory = sessionDirFor(siteId, sessionId);
      const { yamlPath, document } = readYamlDocument(directory);
      const testCaseGroups = bodyOf(request).testCaseGroups;
      if (!Array.isArray(testCaseGroups)) throw new Error('testCaseGroups must be an array');
      document.testCaseGroups = testCaseGroups;
      fs.writeFileSync(yamlPath, YAML.stringify(document), 'utf8');
      regenerateFromYaml(directory);
      response.json({ ok: true });
    } catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  return router;
}
