import express from 'express';
import { rateLimit } from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULTS, FILE_SERVING_LIMITS, HTTP_STATUS, PATTERNS } from '../config';
import { messageOf, param, wildcard } from '../lib/http';
import { resolveInside } from '../lib/fileScope';
import { listSessionNames, sessionsDir } from '../lib/sessionPaths';

/** Lists a site's sessions and serves any file inside one session, strictly under that site's output directory. */
export function createReportRoutes(): express.Router {
  const router = express.Router();
  router.get('/sites/:id/sessions', (request, response) => {
    try { response.json({ sessions: listSessionNames(sessionsDir(param(request, 'id'))) }); }
    catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.get('/sites/:id/sessions/:sessionId/{*filePath}', rateLimit(FILE_SERVING_LIMITS), (request, response) => {
    try {
      const sessionId = param(request, 'sessionId');
      if (!PATTERNS.sessionId.test(sessionId)) return void response.status(HTTP_STATUS.badRequest).json({ error: 'invalid session id' });
      const base = path.join(sessionsDir(param(request, 'id')), path.basename(sessionId));
      const target = resolveInside(base, wildcard(request, 'filePath') || DEFAULTS.defaultSessionFile);
      if (!target) return void response.status(HTTP_STATUS.badRequest).json({ error: 'invalid path' });
      if (!fs.existsSync(target)) return void response.status(HTTP_STATUS.notFound).json({ error: 'not found' });
      response.sendFile(path.relative(base, target), { root: base });
    } catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  return router;
}
