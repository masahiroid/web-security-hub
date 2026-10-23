import express from 'express';
import { DEFAULTS, PATTERNS } from '../config';
import { messageOf, param, queryText } from '../lib/http';
import { openSse } from '../lib/sse';
import { startReplay } from '../services/replayService';
import type { ReplayOptions, ReplayRun } from '../services/replayService';

const flag = (request: express.Request, name: string): boolean => PATTERNS.truthy.test(queryText(request, name) ?? '');
const trimmed = (request: express.Request, name: string, fallback: string): string => queryText(request, name)?.trim() ?? fallback;
/** Replays a session's generated test, streaming its output; closing the connection cancels the run. */
export function createReplayRoutes(): express.Router {
  const router = express.Router();
  router.get('/sites/:id/sessions/:sessionId/replay', async (request, response) => {
    const stream = openSse(response);
    const options: ReplayOptions = {
      recordBaseline: flag(request, 'baseline'), baseUrl: trimmed(request, 'baseUrl', ''), useZap: flag(request, 'zap'), activeZap: flag(request, 'activeZap'),
      authorized: flag(request, 'authorized'), zapBaseUrl: trimmed(request, 'zapBaseUrl', DEFAULTS.zapUrl), zapProxyUrl: trimmed(request, 'zapProxyUrl', DEFAULTS.zapUrl),
    };
    let replay: ReplayRun;
    try {
      replay = startReplay({ siteId: param(request, 'id'), sessionId: param(request, 'sessionId'), options, onLog: line => stream.send('log', { line }) });
      request.on('close', () => replay.cancel());
      stream.send('done', await replay.completed);
    } catch (error: unknown) { stream.send('error', { message: messageOf(error) }); }
    finally { stream.close(); }
  });
  return router;
}
