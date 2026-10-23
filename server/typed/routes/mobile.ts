import express from 'express';
import { messageOf, param } from '../lib/http';
import { openSse } from '../lib/sse';

const PACKAGED_MESSAGE = 'This desktop distribution includes web automation only. Use the source/CLI distribution for mobile automation.';
/** Mobile run (source edition only); the packaged desktop app does not bundle the mobile toolkit. */
export function createMobileRoutes(): express.Router {
  const router = express.Router();
  router.get('/sites/:id/mobile/run', async (request, response) => {
    const stream = openSse(response);
    try {
      if (process.env.WEB_SECURITY_HUB_PACKAGED === '1') throw new Error(PACKAGED_MESSAGE);
      // Loaded on demand: the mobile toolkit is absent from the packaged runtime.
      const { runMobileSession } = await import('../services/mobileService.js');
      stream.send('done', await runMobileSession(param(request, 'id'), line => stream.send('log', { line })));
    } catch (error: unknown) { stream.send('error', { message: messageOf(error) }); }
    finally { stream.close(); }
  });
  return router;
}
