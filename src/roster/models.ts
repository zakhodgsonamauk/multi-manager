/**
 * Model routing. The architect scores each task (complexity, clarity, both 1..5) and a fixed rule
 * maps the two scores to a work tier. Fable is deliberately NOT a work tier: it is a manual,
 * architect-only switch for high-level thinking and is never chosen by this router.
 */
export const WORK_MODELS = ['haiku', 'sonnet', 'opus'] as const;
export type WorkModel = (typeof WORK_MODELS)[number];
export type RoleLike = 'front-desk' | 'architect' | 'developer';

export function isWorkModel(value: string): value is WorkModel {
  return (WORK_MODELS as readonly string[]).includes(value);
}

/** A score is a whole number 1..5. Returns true rather than throwing (used to gate launch input). */
export function isValidScore(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * The fixed rule. `demand = complexity + (6 - clarity)`, range 2..10.
 * 2..3 -> haiku, 4..7 -> sonnet, 8..10 -> opus.
 * A fully-specified but hard task stays on sonnet; a vague or very hard task steps up to opus.
 */
export function resolveModelTier(complexity: number, clarity: number): WorkModel {
  const demand = complexity + (6 - clarity);
  if (demand <= 3) return 'haiku';
  if (demand <= 7) return 'sonnet';
  return 'opus';
}

export interface ResolveModelInput {
  role: RoleLike;
  /** An explicit model for this session (a set_session_model override); wins over everything. */
  modelOverride: string | null;
  complexity: number | null;
  clarity: number | null;
  /** The project's default model; used when there are no scores. Null means "not set". */
  projectDefaultModel: string | null;
}

/** The model a tab is launched on. */
export function resolveLaunchModel(input: ResolveModelInput): string {
  if (input.modelOverride !== null && input.modelOverride !== '') return input.modelOverride;
  if (input.role === 'developer' && isValidScore(input.complexity) && isValidScore(input.clarity)) {
    return resolveModelTier(input.complexity, input.clarity);
  }
  return input.projectDefaultModel ?? 'sonnet';
}
