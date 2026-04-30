/**
 * Shared state shape for Plan Mode.
 *
 * Both the Pi extension and the Sero web UI read/write JSON files
 * matching these shapes. The extension writes them; the UI reads
 * via useAppState (state.json) and direct IPC reads (index.json, plan files).
 */

export interface PlanStep {
  step: number;
  text: string;
  completed: boolean;
}

export type PlanMode = 'normal' | 'plan' | 'execute';

/** Current plan state — lives in state.json. */
export interface PlanModeState {
  mode: PlanMode;
  steps: PlanStep[];
}

export const DEFAULT_STATE: PlanModeState = {
  mode: 'normal',
  steps: [],
};

export function normalizePlanModeState(input: unknown): PlanModeState {
  const state = isRecord(input) ? input : {};
  const mode = isPlanMode(state.mode) ? state.mode : DEFAULT_STATE.mode;
  const steps = Array.isArray(state.steps)
    ? state.steps.map(normalizeStep).filter((step): step is PlanStep => step !== null)
    : [];
  return { mode, steps };
}

// ── Archive types ────────────────────────────────────────────

/** Entry in the archive index (index.json). */
export interface PlanIndexEntry {
  /** Filename relative to the planmode folder, e.g. "plan-2026-02-20T19-14-29.json" */
  filename: string;
  /** ISO 8601 completion timestamp. */
  completedAt: string;
  /** Number of steps in the plan. */
  stepCount: number;
  /** First step text, truncated — used as a preview. */
  summary: string;
}

/** Shape of index.json — the archive manifest. */
export interface PlanIndex {
  plans: PlanIndexEntry[];
}

export const DEFAULT_INDEX: PlanIndex = {
  plans: [],
};

export function normalizePlanIndex(input: unknown): PlanIndex {
  const state = isRecord(input) ? input : {};
  const plans = Array.isArray(state.plans)
    ? state.plans.map(normalizeIndexEntry).filter((entry): entry is PlanIndexEntry => entry !== null)
    : [];
  return { plans };
}

/** Shape of an individual plan-<timestamp>.json archive file. */
export interface ArchivedPlan {
  completedAt: string;
  steps: PlanStep[];
}

export function normalizeArchivedPlan(input: unknown): ArchivedPlan | null {
  if (!isRecord(input)) return null;
  return {
    completedAt: typeof input.completedAt === 'string' ? input.completedAt : '',
    steps: Array.isArray(input.steps)
      ? input.steps.map(normalizeStep).filter((step): step is PlanStep => step !== null)
      : [],
  };
}

function normalizeStep(input: unknown): PlanStep | null {
  if (!isRecord(input)) return null;
  if (typeof input.text !== 'string') return null;
  return {
    step: typeof input.step === 'number' && Number.isFinite(input.step) ? input.step : 0,
    text: input.text,
    completed: input.completed === true,
  };
}

function normalizeIndexEntry(input: unknown): PlanIndexEntry | null {
  if (!isRecord(input) || typeof input.filename !== 'string') return null;
  return {
    filename: input.filename,
    completedAt: typeof input.completedAt === 'string' ? input.completedAt : '',
    stepCount: typeof input.stepCount === 'number' && Number.isFinite(input.stepCount) ? input.stepCount : 0,
    summary: typeof input.summary === 'string' ? input.summary : '',
  };
}

function isPlanMode(value: unknown): value is PlanMode {
  return value === 'normal' || value === 'plan' || value === 'execute';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
