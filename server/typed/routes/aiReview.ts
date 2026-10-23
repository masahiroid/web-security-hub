import express from 'express';
import { getClaudeCodeStatus, reviewWithClaudeCode } from '../../../core/ai/claudeCodeAdapter';
import { apiRateLimit } from '../lib/rateLimit';
import { HTTP_STATUS } from '../config';
import { bodyOf, messageOf } from '../lib/http';

const AUTHORIZATION_REQUIRED = 'Confirm that you authorize sending the displayed SAST findings to local Claude Code.';
/** Optional review of displayed static-analysis findings by a local AI tool; it needs explicit authorization each time. */
export function createAiReviewRoutes(): express.Router {
  const router = express.Router();
  router.use(apiRateLimit());
  router.get('/ai/claude-code/status', async (_request, response) => { response.json(await getClaudeCodeStatus()); });
  router.post('/ai/claude-code/review', async (request, response) => {
    const { authorizationConfirmed, scan, locale } = bodyOf(request);
    if (!authorizationConfirmed) return void response.status(HTTP_STATUS.badRequest).json({ error: AUTHORIZATION_REQUIRED });
    try { response.json(await reviewWithClaudeCode({ scan, locale })); }
    catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  return router;
}
