import express from 'express';
import { rateLimit } from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { OUTPUT_ROOT, generateTestCases } from '../../../core/testing/testCaseGenerator';
import { DEFAULTS, FILE_SERVING_LIMITS, HTTP_STATUS } from '../config';
import { bodyOf, messageOf, param, wildcard } from '../lib/http';
import { resolveInside } from '../lib/fileScope';
import { apiRateLimit } from '../lib/rateLimit';

const TEST_SESSION_ID = /^session-\d+$/;

/** Test-case generation for an arbitrary URL, and the files of the sessions it produced. */
export function createTestGenerationRoutes(): express.Router {
  const router = express.Router();
  router.use(apiRateLimit());
  router.post('/test-cases/generate', async (request, response) => {
    try { response.json(await generateTestCases(bodyOf(request))); }
    catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.get('/test-sessions/:sessionId/{*filePath}', rateLimit(FILE_SERVING_LIMITS), (request, response) => {
    const id = param(request, 'sessionId');
    if (!TEST_SESSION_ID.test(id)) return void response.status(HTTP_STATUS.badRequest).json({ error: 'invalid session id' });
    const base = path.join(OUTPUT_ROOT, id);
    const target = resolveInside(base, wildcard(request, 'filePath') || DEFAULTS.defaultSessionFile);
    if (!target || !fs.existsSync(target)) return void response.status(HTTP_STATUS.notFound).json({ error: 'not found' });
    response.sendFile(path.relative(base, target), { root: base });
  });
  return router;
}
