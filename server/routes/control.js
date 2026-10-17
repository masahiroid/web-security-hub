'use strict';
const express = require('express');
const path = require('path');
const { spawn } = require('child_process');

const router = express.Router();

/** Closes the current HTTP listener, force-dropping any still-open SSE/keep-alive connections so `close`'s callback actually fires promptly. */
function closeHttpServer(httpServer) {
  return new Promise((resolve) => {
    if (!httpServer) {
      resolve();
      return;
    }
    httpServer.close(() => resolve());
    httpServer.closeAllConnections?.();
  });
}

function spawnFreshServer() {
  const entry = path.join(__dirname, '..', 'index.js');
  const projectRoot = path.join(__dirname, '..', '..');
  const child = spawn(process.execPath, [entry], {
    cwd: projectRoot,
    env: process.env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

// Stops the server process entirely. There is no way to start it back up
// from inside the (now-dead) process — the user re-launches via
// start.command/start.bat or `npm start`.
router.post('/control/stop', (req, res) => {
  if (process.env.WEB_SECURITY_HUB_MANAGED === '1') return res.status(409).json({ error: 'Close the application window to stop the managed runtime.' });
  res.json({ ok: true, message: 'stopping' });
  // Wait for `finish` so the response bytes are actually handed to the
  // socket before closeAllConnections() below forcibly destroys it.
  res.on('finish', async () => {
    const httpServer = req.app.get('httpServer');
    await closeHttpServer(httpServer);
    process.exit(0);
  });
});

// Spawns a fresh detached server process bound to the same PORT, then closes
// this one — the new process takes over as soon as the port is free.
router.post('/control/restart', (req, res) => {
  if (process.env.WEB_SECURITY_HUB_MANAGED === '1') return res.status(409).json({ error: 'Close and reopen the application to restart the managed runtime.' });
  res.json({ ok: true, message: 'restarting' });
  res.on('finish', async () => {
    const httpServer = req.app.get('httpServer');
    await closeHttpServer(httpServer);
    spawnFreshServer();
    process.exit(0);
  });
});

module.exports = router;
