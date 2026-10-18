import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { ZAP } from '../domain/zap';

/** Internal child supervisor: the parent's stdin pipe closes even if the parent crashes. */
export function superviseZap(argv: readonly string[]): void {
  const [java, jar, home, config, port] = argv;
  if (argv.length !== 5 || !java || !jar || !home || !config || !port ||
      ![java, jar, home, config].every(isAbsolute) || !/^\d+$/.test(port)) throw Error('Invalid internal ZAP invocation');
  const child = spawn(java, [`-Xmx${ZAP.heapMb}m`, '-Djava.awt.headless=true', '-jar', jar, '-daemon', '-silent',
    '-host', ZAP.host, '-port', port, '-dir', home, '-newsession', home + '/owned-session', '-configfile', config,
    '-config', 'database.recoverylog=false'], { cwd: dirname(jar), windowsHide: true, stdio: 'ignore' });
  let timer: ReturnType<typeof setTimeout> | undefined; let exited = false;
  const stop = () => {
    if (exited || timer) return;
    child.kill('SIGTERM'); timer = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, ZAP.shutdownMs); timer.unref();
  };
  const done = () => {
    if (exited) return;
    exited = true; if (timer) clearTimeout(timer); process.stdin.destroy();
    void rm(home, { recursive: true, force: true, maxRetries: ZAP.cleanupRetries, retryDelay: ZAP.pollMs })
      .then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  };
  child.once('exit', done); child.once('error', done);
  process.stdin.on('end', stop); process.stdin.on('error', stop); process.stdin.resume();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
if (require.main === module) {
  try { superviseZap(process.argv.slice(2)); } catch { process.exitCode = 1; }
}
