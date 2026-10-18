import { TRANSPORT } from '../domain/config';
import type { ContractsPort, Control, Profile } from '../domain/types';
export function routeAt(origin: string, route: string): string {
  const url = new URL(route, origin);
  if (!route.startsWith('/') || route.includes('\\') || route.includes('%') || url.origin !== origin || url.pathname !== route || url.search || url.hash) throw Error('Invalid trusted route');
  return origin + route;
}
function exactOrigin(origin: string): void {
  const url = new URL(origin);
  if (url.protocol !== TRANSPORT.protocol || !TRANSPORT.loopbackHosts.includes(url.hostname) || !url.port || url.origin !== origin) throw Error('Numeric loopback origin required');
}
export const targetKey = ({ origin, route, method }: { origin: string; route: string; method: string }) => JSON.stringify([origin, route, method]);
export function createCatalog(contracts: ContractsPort, profiles: readonly unknown[], controls: readonly unknown[]) {
  const profileMap = new Map<string, Profile>();
  const controlMap = new Map<string, Control>();
  for (const input of profiles) {
    const profile = contracts.validate('profile', input);
    exactOrigin(profile.origin);
    for (const step of profile.setup) routeAt(profile.origin, step.route);
    if (profileMap.has(profile.profileId)) throw Error('Duplicate profile');
    profileMap.set(profile.profileId, profile);
  }
  for (const input of controls) {
    const control = contracts.validate('control', input);
    contracts.validate('seed', control.seed);
    exactOrigin(control.origin); routeAt(control.origin, control.route);
    const key = targetKey(control);
    if (controlMap.has(key)) throw Error('Duplicate control');
    controlMap.set(key, control);
  }
  return { profile: (id: string) => profileMap.get(id), control: (key: string) => controlMap.get(key) };
}
