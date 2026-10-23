const loaded: unknown = require('../../package.json');
const field = (name: string): string => {
  const value: unknown = loaded && typeof loaded === 'object' ? Reflect.get(loaded, name) : undefined;
  return typeof value === 'string' ? value : '';
};
/** Name and version of the running application, read once from its package metadata. */
export const PACKAGE_INFO = Object.freeze({ name: field('name'), version: field('version') });
