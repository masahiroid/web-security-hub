import { readFileSync } from 'node:fs';
import { textOf } from './text';

/** One generated input of a test case. */
export interface Assignment {
  readonly kind: string;
  readonly value: string;
  readonly rationale: string | undefined;
}

export interface TestCase {
  readonly id: string;
  readonly name: string;
  readonly assignments: readonly (readonly [string, Assignment])[];
}

export interface CaseGroup {
  readonly url: string;
  readonly cases: readonly TestCase[];
}

export interface RunRecord {
  readonly testCaseId: string;
  readonly ok: boolean | undefined;
  readonly error: string | undefined;
  readonly screenshotPath: string | undefined;
}

export interface FormField {
  readonly selector: string;
  readonly type: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function optionalText(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : textOf(value);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function readJsonLines(file: string): unknown[] {
  try {
    return readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(line => line.trim())
      .map((line): unknown => JSON.parse(line));
  } catch {
    return [];
  }
}

function parseAssignment(value: unknown): Assignment {
  const source = isRecord(value) ? value : {};
  return { kind: textOf(source['kind']), value: textOf(source['value']), rationale: optionalText(source['rationale']) };
}

function parseCase(source: Readonly<Record<string, unknown>>): TestCase {
  const assignments = isRecord(source['assignments']) ? Object.entries(source['assignments']) : [];
  return {
    id: textOf(source['id']),
    name: textOf(source['name']),
    assignments: assignments.map(([selector, value]) => [selector, parseAssignment(value)] as const),
  };
}

export function readCaseGroups(file: string): readonly CaseGroup[] {
  return records(readJson(file)).map(group => ({ url: textOf(group['url']), cases: records(group['cases']).map(parseCase) }));
}

export function readRuns(file: string): ReadonlyMap<string, RunRecord> {
  const byCase = new Map<string, RunRecord>();
  for (const entry of readJsonLines(file)) {
    if (!isRecord(entry) || !entry['testCaseId']) continue;
    byCase.set(textOf(entry['testCaseId']), {
      testCaseId: textOf(entry['testCaseId']),
      ok: entry['ok'] === undefined ? undefined : Boolean(entry['ok']),
      error: optionalText(entry['error']),
      screenshotPath: entry['screenshotPath'] ? textOf(entry['screenshotPath']) : undefined,
    });
  }
  return byCase;
}

export function readFormFields(file: string): readonly FormField[] {
  return records(readJson(file)).flatMap(form => records(form['fields']))
    .map(field => ({ selector: textOf(field['selector']), type: textOf(field['type']) }));
}
