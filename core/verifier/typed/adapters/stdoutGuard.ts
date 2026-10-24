import { format } from 'node:util';

/** The MCP protocol owns stdout; any stray console output would corrupt it, so console methods write to stderr instead. */
export function redirectConsoleToStderr(): void {
  const toStderr = (...parts: readonly unknown[]): void => { process.stderr.write(`${format(...parts)}\n`); };
  console.log = toStderr; console.info = toStderr; console.debug = toStderr; console.warn = toStderr; console.trace = toStderr;
}
