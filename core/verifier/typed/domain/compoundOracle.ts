import { GENETIC_FIXTURE } from './geneticFixtureConfig';
import type { Oracle } from './types';
/** Independent business rule: only the owner may commit, regardless of challenge or HTTP status. */
export function compoundOracle(actor: string, committed: boolean): Oracle {
  return committed && actor !== GENETIC_FIXTURE.owner ? 'violated' : 'passed';
}
