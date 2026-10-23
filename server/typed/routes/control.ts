import express from 'express';
import { spawn } from 'node:child_process';
import type { Server } from 'node:http';
import { HTTP_STATUS } from '../config';
import { PROJECT_ROOT, SERVER_ENTRY } from '../paths';

const MANAGED = Object.freeze({
  stop: 'Close the application window to stop the managed runtime.',
  restart: 'Close and reopen the application to restart the managed runtime.',
});
const managed = (): boolean => process.env.WEB_SECURITY_HUB_MANAGED === '1';
/** Closes the HTTP listener, dropping still-open streaming and keep-alive connections so the close callback fires promptly. */
function closeHttpServer(server: Server | undefined): Promise<void> {
  return new Promise(resolve => {
    if (!server) return resolve();
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
function spawnFreshServer(): void {
  const child = spawn(process.execPath, [SERVER_ENTRY], { cwd: PROJECT_ROOT, env: process.env, detached: true, stdio: 'ignore' });
  child.unref();
}
const listenerOf = (request: express.Request): Server | undefined => {
  const server: unknown = request.app.get('httpServer');
  return server instanceof Object && 'close' in server ? server as Server : undefined;
};
/** Stop and restart controls for the standalone server; a managed runtime is closed from its own window instead. */
export function createControlRoutes(): express.Router {
  const router = express.Router();
  // Stops the process entirely; it cannot be started again from inside, so the user relaunches it.
  router.post('/control/stop', (request, response) => {
    if (managed()) return void response.status(HTTP_STATUS.conflict).json({ error: MANAGED.stop });
    response.json({ ok: true, message: 'stopping' });
    // Wait for `finish` so the response bytes reach the socket before connections are destroyed.
    response.on('finish', () => { void closeHttpServer(listenerOf(request)).then(() => process.exit(0)); });
  });
  // Starts a fresh detached server on the same port, then closes this one; the new process takes over once the port is free.
  router.post('/control/restart', (request, response) => {
    if (managed()) return void response.status(HTTP_STATUS.conflict).json({ error: MANAGED.restart });
    response.json({ ok: true, message: 'restarting' });
    response.on('finish', () => { void closeHttpServer(listenerOf(request)).then(() => { spawnFreshServer(); process.exit(0); }); });
  });
  return router;
}
