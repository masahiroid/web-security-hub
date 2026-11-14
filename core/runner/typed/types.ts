/** Shared shapes for the form runner. Forms come from the crawler or a hand-written manual-forms file. */

export type Log = (line: string) => void;

/** Field constraints; HTML-scanned values may be overridden by Rule Spec values (source 'spec'). */
export interface RunnerConstraints {
  readonly source?: string | undefined;
  readonly required?: boolean | undefined;
  readonly maxLength?: number | undefined;
  readonly minLength?: number | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  readonly pattern?: string | undefined;
}

export interface RunnerField {
  selector: string;
  type: string;
  tag?: string | undefined;
  name?: string | undefined;
  id?: string | undefined;
  label?: string | undefined;
  placeholder?: string | undefined;
  semantic?: string | undefined;
  constraints?: RunnerConstraints | undefined;
}

export type PreStepAction = 'radio' | 'check' | 'uncheck' | 'click' | 'setFile';

/** Declarative step run before filling, for wizard-style forms (manual forms only). */
export interface PreStep {
  readonly action: PreStepAction | string;
  readonly selector: string;
  readonly value?: string | undefined;
  readonly path?: string | undefined;
}

export interface RunnerForm {
  url: string;
  formSelector?: string | undefined;
  submitSelector?: string | undefined;
  fields: RunnerField[];
  preSteps?: readonly PreStep[] | undefined;
}

/** One candidate value for one field. kind is normal / boundary / abnormal. */
export interface FieldValue {
  readonly fieldSelector: string;
  readonly kind: string;
  readonly value: string;
  readonly rationale: string;
}

export interface TestCase {
  readonly id: string;
  readonly name: string;
  readonly assignments: Readonly<Record<string, FieldValue>>;
}

export interface CaseResult {
  readonly testCaseId: string;
  readonly resultUrl: string;
  readonly domHash: string;
  readonly errorMessages: readonly string[];
  readonly screenshotPath?: string;
  readonly ok: boolean;
  readonly error: string | undefined;
}

export interface UrlCatalogPage {
  readonly url: string;
  readonly title: string;
  readonly markers: readonly string[];
  readonly textHash: string;
  readonly forms: readonly CatalogFormSummary[];
}

export interface CatalogFormSummary {
  readonly formSelector: string | undefined;
  readonly submitSelector: string | undefined;
  readonly fieldCount: number;
  readonly requiredCount: number;
}

export interface UrlCatalog {
  readonly seedUrl: string;
  readonly generatedAt: string;
  readonly visited: readonly string[];
  readonly pages: readonly UrlCatalogPage[];
}

/** Persistence port; JsonStore is the file adapter. */
export interface RunnerStore {
  saveForm(form: RunnerForm): Promise<void>;
  saveTestCases(url: string, cases: readonly TestCase[]): Promise<void>;
  saveRunResult(url: string, result: CaseResult): Promise<void>;
  saveUrlCatalog(catalog: UrlCatalog): Promise<void>;
}

export interface FieldSemantic {
  readonly selector: string;
  readonly semantic?: string | undefined;
}

/** Port for field-meaning inference (rule-based or LLM). */
export interface SemanticProvider {
  readonly name: string;
  inferFieldSemantics(fields: readonly RunnerField[], context: string): Promise<readonly FieldSemantic[]>;
}

export interface ScenarioExpansionTemplate {
  readonly name: string;
  readonly overrides?: Readonly<Record<string, unknown>> | undefined;
}

export interface ScenarioExpansionEntry {
  readonly urlPattern: string;
  readonly triggerSelector: string;
  readonly templates: readonly ScenarioExpansionTemplate[];
}
