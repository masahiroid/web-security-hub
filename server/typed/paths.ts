import path from 'node:path';

/** Repository (or staged runtime) root. The emitted file lives in server/generated, two levels below it. */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const SERVER_ENTRY = path.join(PROJECT_ROOT, 'server', 'index.js');
export const PUBLIC_DIRECTORY = path.join(PROJECT_ROOT, 'public');
export const TRAINING_DIRECTORY = path.join(PROJECT_ROOT, 'docs', 'training');
