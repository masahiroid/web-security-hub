import express from 'express';
import { messageOf, param } from '../lib/http';
import { openSse } from '../lib/sse';
import { generateSiteTestSession } from '../services/testPipelineService';
import { apiRateLimit } from '../lib/rateLimit';

/** Runs the test-generation pipeline for a saved site and streams its progress. */
export function createPipelineRoutes(): express.Router {
  const router = express.Router();
  router.use(apiRateLimit());
  router.get('/sites/:id/pipeline/run', async (request, response) => {
    const stream = openSse(response);
    try { stream.send('done', await generateSiteTestSession(param(request, 'id'), line => stream.send('log', { line }))); }
    catch (error: unknown) { stream.send('error', { message: messageOf(error) }); }
    finally { stream.close(); }
  });
  return router;
}
