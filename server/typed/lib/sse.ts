import type { Response } from 'express';
import { HTTP_STATUS } from '../config';

export interface EventStream { send(event: string, data: unknown): void; close(): void }
/** Starts a server-sent-event response; long operations report progress and a final done or error event. */
export function openSse(response: Response): EventStream {
  response.writeHead(HTTP_STATUS.ok, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  return {
    send(event, data) { response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); },
    close() { response.end(); },
  };
}
