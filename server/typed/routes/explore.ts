import express from 'express';
import { rateLimit } from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULTS, FILE_SERVING_LIMITS, HTTP_STATUS, PATTERNS } from '../config';
import { messageOf, param, wildcard } from '../lib/http';
import { resolveInside } from '../lib/fileScope';
import { openSse } from '../lib/sse';
import { exploreSessionsDir, listSessionNames } from '../lib/sessionPaths';
import { exploreSiteSession } from '../services/exploreService';

/** Screen exploration run (streamed) and its saved sessions. */
export function createExploreRoutes(): express.Router {
  const router = express.Router();
  router.get('/sites/:id/explore/run', async (request, response) => {
    const stream = openSse(response);
    try { stream.send('done', await exploreSiteSession(param(request, 'id'), line => stream.send('log', { line }))); }
    catch (error: unknown) { stream.send('error', { message: messageOf(error) }); }
    finally { stream.close(); }
  });
  router.get('/sites/:id/explore-sessions', (request, response) => {
    try { response.json({ sessions: listSessionNames(exploreSessionsDir(param(request, 'id'))) }); }
    catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.get('/sites/:id/explore-sessions/:sessionId/{*filePath}', rateLimit(FILE_SERVING_LIMITS), (request, response) => {
    try {
      const sessionId = param(request, 'sessionId');
      if (!PATTERNS.sessionId.test(sessionId)) return void response.status(HTTP_STATUS.badRequest).json({ error: 'invalid session id' });
      const base = path.join(exploreSessionsDir(param(request, 'id')), path.basename(sessionId));
      const target = resolveInside(base, wildcard(request, 'filePath') || DEFAULTS.defaultExploreFile);
      if (!target || !fs.existsSync(target)) return void response.status(HTTP_STATUS.notFound).json({ error: 'not found' });
      response.sendFile(path.relative(base, target), { root: base });
    } catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  return router;
}
