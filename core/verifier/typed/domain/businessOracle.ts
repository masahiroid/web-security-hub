import { FIXTURE } from './config';
import type { Oracle } from './types';

// Independent of Express route guards: evaluates observed business facts.
export function recordOracle(profile: string, owner: string, confirmation: boolean | null): Oracle {
  const ownership = profile !== FIXTURE.anonymous && (profile === FIXTURE.admin || profile === owner);
  return ownership && confirmation !== false ? 'passed' : 'violated';
}
export function boundaryOracle(participants: unknown, label: unknown, accepted: boolean): Oracle {
  const countAllowed = typeof participants === 'number' && Number.isInteger(participants)
    && participants >= FIXTURE.participantsMinimum && participants <= FIXTURE.participantsMaximum;
  const length = typeof label === 'string' ? [...label.normalize(FIXTURE.normalization)].length : null;
  const labelAllowed = length !== null && length >= FIXTURE.labelMinimum && length <= FIXTURE.labelMaximum;
  return accepted === (countAllowed && labelAllowed) ? 'passed' : 'violated';
}
