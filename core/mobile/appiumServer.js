'use strict';
const path = require('path');
const { spawn } = require('child_process');

const APPIUM_BIN = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'appium');
const START_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 300;

/**
 * Lifecycle wrapper around a local Appium server process (started via the
 * project's own node_modules/.bin/appium, same convention as this app
 * driving Playwright browsers directly rather than requiring a separately
 * installed CLI). One server can host multiple driver sessions; callers
 * connect to it with core/mobile/mobileSession.js.
 */
class AppiumServer {
  constructor({ port = 4723, log = () => {} } = {}) {
    this.port = port;
    this.log = log;
    this.process = undefined;
  }

  get url() {
    return `http://127.0.0.1:${this.port}`;
  }

  async start() {
    if (this.process) return this.url;
    const child = spawn(APPIUM_BIN, ['--port', String(this.port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.process = child;
    let startupError;
    child.stdout.on('data', (chunk) => this.log(`[appium] ${chunk.toString('utf8').trim()}`));
    child.stderr.on('data', (chunk) => this.log(`[appium:stderr] ${chunk.toString('utf8').trim()}`));
    child.on('error', (error) => {
      startupError = error;
    });
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) this.log(`[appium] server exited with code ${code}`);
      this.process = undefined;
    });

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      if (!this.process) throw new Error('Appium server process exited before becoming ready');
      try {
        const res = await fetch(`${this.url}/status`);
        if (res.ok) return this.url;
      } catch {
        // not listening yet — keep polling
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    child.kill();
    throw new Error(`Appium server did not become ready within ${START_TIMEOUT_MS}ms`);
  }

  async stop() {
    if (!this.process) return;
    const child = this.process;
    this.process = undefined;
    await new Promise((resolve) => {
      child.once('exit', () => resolve());
      child.kill();
      setTimeout(resolve, 5_000); // don't hang forever if the process ignores the signal
    });
  }
}

module.exports = { AppiumServer };
