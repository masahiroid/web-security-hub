import { CONTRACT_VERSION, FIXTURE } from './config';
import { CAMPAIGN, RANDOM } from './campaignConfig';
import type { Candidate, Scenario } from './campaignTypes';
import type { Values } from './types';
function shuffled<T>(input: readonly T[], randomSeed: number): T[] {
  let state = randomSeed >>> 0;
  const items = [...input];
  for (let index = items.length - 1; index > 0; index--) {
    state = (Math.imul(state, RANDOM.multiplier) + RANDOM.increment) >>> 0;
    const selected = Math.floor(state / RANDOM.modulus * (index + 1));
    const left = items[index]; const right = items[selected];
    if (left !== undefined && right !== undefined) { items[index] = right; items[selected] = left; }
  }
  return items;
}
export function generateFixtureCandidates(scenario: Scenario, randomSeed: number, maximum: number): readonly Candidate[] {
  if (!Number.isInteger(randomSeed) || randomSeed < 0 || randomSeed > CAMPAIGN.maximumRandomSeed || !Number.isInteger(maximum) || maximum < CAMPAIGN.minimumBudget || maximum > CAMPAIGN.maximumCandidates) throw Error('Invalid candidate plan');
  type Variant = { values: Values; omitFields: readonly string[]; mutation: Candidate['mutation']; profile: string };
  const variants: Variant[] = [];
  const profile = scenario.candidateProfiles[0];
  if (!profile) throw Error('No fixture profile');
  const add = (values: Values, mutation: Variant['mutation'], omitFields: readonly string[] = [], actor = profile) => variants.push({ values, mutation, omitFields, profile: actor });
  add(scenario.baseSeed.values, 'baseline');
  if (scenario.id === 'boundary') {
    for (const value of [FIXTURE.participantsMinimum - 1, FIXTURE.participantsMinimum, FIXTURE.participantsMaximum, FIXTURE.participantsMaximum + 1]) add({ ...scenario.baseSeed.values, participants: value }, 'boundary');
    for (const length of [FIXTURE.labelMinimum - 1, FIXTURE.labelMinimum, FIXTURE.labelMaximum, FIXTURE.labelMaximum + 1]) add({ ...scenario.baseSeed.values, label: CAMPAIGN.asciiLabel.repeat(length) }, 'boundary');
    for (const label of [CAMPAIGN.combiningLabel.repeat(FIXTURE.labelMaximum), CAMPAIGN.supplementaryLabel.repeat(FIXTURE.labelMaximum), CAMPAIGN.supplementaryLabel.repeat(FIXTURE.labelMaximum + 1)]) add({ ...scenario.baseSeed.values, label }, 'unicode');
    for (const field of scenario.allowedFields) add(Object.fromEntries(Object.entries(scenario.baseSeed.values).filter(([key]) => key !== field)), 'missing-field', [field]);
  } else for (const actor of scenario.candidateProfiles) add(scenario.baseSeed.values, 'profile', [], actor);
  const unique = new Map<string, Variant>();
  for (const variant of variants) {
    const key = JSON.stringify([variant.profile, Object.entries(variant.values).sort(([a], [b]) => a.localeCompare(b)), [...variant.omitFields].sort()]);
    if (!unique.has(key)) unique.set(key, variant);
  }
  return Object.freeze(shuffled([...unique.values()], randomSeed).slice(0, maximum).map((variant, index) => Object.freeze({
    parentSeedId: scenario.baseSeed.seedId, mutation: variant.mutation, authProfileId: variant.profile,
    seed: Object.freeze({ schemaVersion: CONTRACT_VERSION, seedId: `${scenario.id}-${CAMPAIGN.candidateSuffix}-${String(index + 1).padStart(CAMPAIGN.candidateDigits, '0')}`, values: Object.freeze({ ...variant.values }), omitFields: Object.freeze([...variant.omitFields]), rationale: `Deterministic ${variant.mutation} fixture candidate` })
  })));
}
