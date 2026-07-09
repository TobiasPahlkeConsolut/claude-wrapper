// Single source of truth for the models (and effort levels) this wrapper will
// pass to the `claude` CLI. The HTTP route (GET /v1/models), the request
// validator (chat route), and the CLI invocation (claude-resolver) all resolve
// model strings through here so the allowlist and the parsing rules can never
// drift apart.

// Base model identifiers accepted by the CLI's --model flag. Short aliases
// (fable/opus/sonnet/haiku) resolve to the latest model in that tier; the full
// IDs let a caller pin an exact version. Keep in sync with shared/models.md in
// the claude-api skill when new models ship.
export const BASE_MODEL_IDS = [
  // Latest-of-tier aliases
  'fable',
  'opus',
  'sonnet',
  'haiku',

  // Pinned full model IDs
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
] as const;

// Effort levels accepted by the CLI's --effort flag (see `claude --help`).
// Higher levels spend a larger thinking budget: more capable on hard reasoning,
// slower and costlier per turn.
export const VALID_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof VALID_EFFORT_LEVELS)[number];

// Separator between the base model and an optional effort suffix in a caller's
// model id, e.g. `opus:high`. A colon is unambiguous: no base id contains one,
// and pinned ids (`claude-opus-4-8`) contain hyphens, so a `-` suffix could not
// be split reliably.
export const EFFORT_SEPARATOR = ':';

export const VALID_MODEL_IDS: ReadonlySet<string> = new Set(BASE_MODEL_IDS);
const EFFORT_SET: ReadonlySet<string> = new Set(VALID_EFFORT_LEVELS);

export interface ModelSpec {
  /** Base model id to pass to the CLI's --model flag. */
  model: string;
  /** Optional effort level to pass to the CLI's --effort flag. */
  effort?: EffortLevel;
}

/**
 * Parse a caller-supplied model id of the form `<model>` or `<model>:<effort>`
 * into its base model and (optional) effort level.
 *
 * Returns null when the base model isn't on the allowlist, or when an effort
 * suffix is present but isn't a recognized level. Callers treat null as
 * "unsupported model" and reject the request. Because both halves are checked
 * against fixed allowlists, this doubles as the injection guard that keeps
 * shell metacharacters out of the CLI invocation (the non-streaming path builds
 * its command through a shell).
 */
export function parseModelSpec(spec: string): ModelSpec | null {
  if (typeof spec !== 'string') {
    return null;
  }

  const sep = spec.indexOf(EFFORT_SEPARATOR);
  if (sep === -1) {
    return VALID_MODEL_IDS.has(spec) ? { model: spec } : null;
  }

  const model = spec.slice(0, sep);
  const effort = spec.slice(sep + 1);
  if (!VALID_MODEL_IDS.has(model) || !EFFORT_SET.has(effort)) {
    return null;
  }
  return { model, effort: effort as EffortLevel };
}

export function isValidModel(spec: string): boolean {
  return parseModelSpec(spec) !== null;
}
