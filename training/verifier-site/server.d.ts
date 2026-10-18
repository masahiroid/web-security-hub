import type { FixtureInstance } from '../../core/verifier/typed/adapters/fixtureRuntime';
import type { Mode } from '../../core/verifier/typed/domain/campaignTypes';
export function createFixture(options?: { initialMode?: Mode; instrumentation?: boolean; evidenceCapacity?: number }): FixtureInstance & { readonly controlToken: string };
