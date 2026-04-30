/**
 * Plan Mode Extension — Sero adaptation.
 *
 * Read-only exploration mode with a plan_todos tool for structured
 * plan management. The agent uses the tool to create plans and mark
 * steps complete — no fragile text/regex parsing needed.
 *
 * Completed plans are archived as plan-<timestamp>.json files with
 * an index.json manifest in the same folder.
 *
 * Tools: plan_todos (set_plan, complete_step, list)
 * Commands: /plan, /plan-execute, /plan-todos
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StringEnum } from '@mariozechner/pi-ai';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Text } from '@mariozechner/pi-tui';
import { Type } from '@sinclair/typebox';

import {
  normalizePlanIndex,
  normalizePlanModeState,
  type PlanModeState,
  type PlanStep,
  type PlanMode,
  type PlanIndex,
  type ArchivedPlan,
} from '../shared/types';
import { isSafeCommand } from '../shared/utils';

// ── Constants ──────────────────────────────────────────────────

const PLAN_MODE_TOOLS = [
  'read', 'bash', 'grep', 'find', 'ls', 'questionnaire', 'sero-cli',
];
const NORMAL_MODE_TOOLS = ['read', 'bash', 'edit', 'write', 'sero-cli'];
const PLANMODE_DIR = path.join('.sero', 'apps', 'planmode');
const STATE_REL_PATH = path.join(PLANMODE_DIR, 'state.json');
const INDEX_REL_PATH = path.join(PLANMODE_DIR, 'index.json');

// ── Extension ──────────────────────────────────────────────────

export default function planModeExtension(pi: ExtensionAPI): void {
  let currentMode: PlanMode = 'normal';
  let steps: PlanStep[] = [];
  let statePath = '';
  let indexPath = '';
  let planDir = '';
  let activeExecutionStep: number | null = null;
  let completedStepDuringTurn = false;

  // ── Path & state helpers ───────────────────────────────────

  function ensureStatePath(ctx?: { cwd?: string }): void {
    if (!statePath && ctx?.cwd) {
      statePath = path.join(ctx.cwd, STATE_REL_PATH);
      indexPath = path.join(ctx.cwd, INDEX_REL_PATH);
      planDir = path.join(ctx.cwd, PLANMODE_DIR);
      console.log(`[plan-mode] statePath resolved: ${statePath}`);
    }
  }

  async function atomicWrite(filePath: string, data: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, filePath);
  }

  async function syncStateToFile(): Promise<void> {
    if (!statePath) {
      console.warn('[plan-mode] syncStateToFile skipped — statePath empty');
      return;
    }
    const state: PlanModeState = { mode: currentMode, steps };
    try {
      await atomicWrite(statePath, state);
    } catch (err) {
      console.error('[plan-mode] Failed to sync state:', err);
    }
  }

  /** Archive the current plan and update index.json. */
  async function archivePlan(): Promise<void> {
    if (!planDir || steps.length === 0) return;
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-');
    const filename = `plan-${ts}.json`;
    const filePath = path.join(planDir, filename);

    const archive: ArchivedPlan = {
      completedAt: now.toISOString(),
      steps: [...steps],
    };

    try {
      await atomicWrite(filePath, archive);

      // Read existing index (or start fresh)
      const index = await readIndex();
      const summary = steps[0]?.text.slice(0, 120) ?? '';
      index.plans.unshift({
        filename,
        completedAt: now.toISOString(),
        stepCount: steps.length,
        summary,
      });
      await atomicWrite(indexPath, index);
      console.log(`[plan-mode] Archived plan: ${filename}`);
    } catch (err) {
      console.error('[plan-mode] Failed to archive plan:', err);
    }
  }

  async function readIndex(): Promise<PlanIndex> {
    try {
      const raw = await fs.readFile(indexPath, 'utf8');
      return normalizePlanIndex(JSON.parse(raw));
    } catch {
      return { plans: [] };
    }
  }

  function makeResult(text: string, error = false) {
    return {
      content: [{ type: 'text' as const, text }],
      details: {},
      ...(error && { isError: true }),
    };
  }

  // ── Mode management ────────────────────────────────────────

  async function resetPlanMode(): Promise<void> {
    pi.setActiveTools(NORMAL_MODE_TOOLS);
    currentMode = 'normal';
    steps = [];
    activeExecutionStep = null;
    completedStepDuringTurn = false;
    await syncStateToFile();
  }

  async function togglePlanMode(): Promise<string> {
    if (currentMode !== 'normal') {
      await resetPlanMode();
      return 'Plan mode disabled. Current plan cleared.';
    }
    // Apply runtime tool changes before mutating state so failed early calls
    // do not leave the UI stuck in plan mode.
    pi.setActiveTools(PLAN_MODE_TOOLS);
    currentMode = 'plan';
    steps = [];
    await syncStateToFile();
    return 'Plan mode enabled. Only read-only tools + plan_todos available.';
  }

  async function enterExecutionMode(): Promise<void> {
    pi.setActiveTools(NORMAL_MODE_TOOLS);
    currentMode = 'execute';
    await syncStateToFile();
  }

  function persistEntry(): void {
    pi.appendEntry('plan-mode', { mode: currentMode, steps });
  }

  function send(customType: string, content: string, triggerTurn = false): void {
    pi.sendMessage({ customType, content, display: true }, { triggerTurn });
  }

  // ── Tool: plan_todos ───────────────────────────────────────

  pi.registerTool({
    name: 'plan_todos',
    label: 'Plan Todos',
    description:
      'Manage the task plan. In Sero, call this via the sero-cli tool, e.g. `plan_todos --action set_plan --steps \'["Step 1", "Step 2"]\'`.\n' +
      'Actions:\n' +
      '  set_plan — Create/replace the plan. Requires `steps` (array of step description strings).\n' +
      '  complete_step — Mark a step done. Requires `step` (step number, 1-indexed).\n' +
      '  list — Show all steps with completion status.',
    parameters: Type.Object({
      action: StringEnum(['set_plan', 'complete_step', 'list'] as const),
      steps: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Step descriptions (for set_plan)',
        }),
      ),
      step: Type.Optional(
        Type.Number({ description: 'Step number to complete (for complete_step)' }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      ensureStatePath(ctx);

      switch (params.action) {
        case 'set_plan': {
          if (!params.steps?.length) {
            return makeResult('Error: steps array is required for set_plan', true);
          }
          steps = params.steps.map((text, i) => ({
            step: i + 1,
            text,
            completed: false,
          }));
          await syncStateToFile();
          persistEntry();
          const list = steps.map((s) => `${s.step}. ○ ${s.text}`).join('\n');
          return makeResult(
            `Plan created (${steps.length} steps):\n${list}\n\nPLAN MODE INSTRUCTION: Stop now. Do not expand, execute, or restate the plan. Wait for the user to run /plan-execute.`,
          );
        }

        case 'complete_step': {
          if (params.step === undefined) {
            return makeResult('Error: step number required for complete_step', true);
          }
          const item = steps.find((s) => s.step === params.step);
          if (!item) {
            return makeResult(`Error: step ${params.step} not found`, true);
          }
          item.completed = true;
          if (currentMode === 'execute') completedStepDuringTurn = true;
          if (activeExecutionStep === item.step) activeExecutionStep = null;
          await syncStateToFile();
          persistEntry();
          const done = steps.filter((s) => s.completed).length;
          return makeResult(
            `✓ Step ${item.step} completed: ${item.text} (${done}/${steps.length})`,
          );
        }

        case 'list': {
          if (steps.length === 0) return makeResult('No plan steps yet.');
          const done = steps.filter((s) => s.completed).length;
          const list = steps
            .map((s) => `${s.step}. ${s.completed ? '✓' : '○'} ${s.text}`)
            .join('\n');
          return makeResult(`Plan (${done}/${steps.length} complete):\n${list}`);
        }

        default:
          return makeResult(`Unknown action: ${params.action}`, true);
      }
    },

    renderCall(args, theme) {
      let text = theme.fg('toolTitle', theme.bold('plan_todos '));
      text += theme.fg('muted', args.action);
      if (args.step !== undefined) text += ` ${theme.fg('accent', `#${args.step}`)}`;
      if (args.steps?.length) text += ` ${theme.fg('dim', `(${args.steps.length} steps)`)}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const msg = result.content?.[0]?.type === 'text' ? result.content[0].text : '';
      if (msg.startsWith('Error:')) return new Text(theme.fg('error', msg), 0, 0);
      return new Text(theme.fg('success', '✓ ') + theme.fg('muted', msg), 0, 0);
    },
  });

  // ── Flag (Pi CLI: --plan) ──────────────────────────────────

  pi.registerFlag('plan', {
    description: 'Start in plan mode (read-only exploration)',
    type: 'boolean',
    default: false,
  });

  // ── Commands ───────────────────────────────────────────────

  pi.registerCommand('plan', {
    description: 'Toggle plan mode (read-only exploration)',
    handler: async (_args, ctx) => {
      ensureStatePath(ctx);
      send('plan-mode-toggle', await togglePlanMode());
      persistEntry();
    },
  });

  pi.registerCommand('plan-execute', {
    description: 'Execute the current plan',
    handler: async (_args, ctx) => {
      ensureStatePath(ctx);
      if (steps.length === 0) {
        send('plan-mode-empty', 'No plan steps. Create a plan first with /plan.');
        return;
      }
      await enterExecutionMode();
      const first = steps.find((s) => !s.completed);
      const msg = first
        ? `Executing plan. Starting with step ${first.step}: ${first.text}`
        : 'All steps already completed.';
      send('plan-mode-execute', msg, true);
      persistEntry();
    },
  });

  pi.registerCommand('plan-stop', {
    description: 'Stop plan execution and clear the current plan',
    handler: async (_args, ctx) => {
      ensureStatePath(ctx);
      await resetPlanMode();
      ctx.abort?.();
      send('plan-mode-stop', 'Plan stopped and cleared. Normal mode restored.');
      persistEntry();
    },
  });

  pi.registerCommand('plan-todos', {
    description: 'Show current plan progress',
    handler: async (_args, ctx) => {
      ensureStatePath(ctx);
      if (steps.length === 0) {
        send('plan-mode-empty', 'No plan steps yet.');
        return;
      }
      const done = steps.filter((s) => s.completed).length;
      const list = steps
        .map((s) => `${s.step}. ${s.completed ? '✓' : '○'} ${s.text}`)
        .join('\n');
      send('plan-mode-list', `**Plan (${done}/${steps.length}):**\n\n${list}`);
    },
  });

  // ── Event: block destructive bash in plan mode ─────────────

  pi.on('tool_call', async (event) => {
    if (currentMode !== 'plan') return;

    if (event.toolName === 'bash') {
      const command = event.input.command as string;
      if (!isSafeCommand(command)) {
        return {
          block: true,
          reason: `Plan mode: command blocked. Use /plan to disable first.\nCommand: ${command}`,
        };
      }
      return;
    }

    if (event.toolName === 'sero-cli') {
      const command = String(event.input.command ?? '').trim();
      const allowed = /^(?:sero\s+)?(?:plan_todos|plan-stop)(?:\s|$)/.test(command) ||
        /^(?:sero\s+)?help\s+(?:plan_todos|plan-stop)(?:\s|$)/.test(command);
      if (!allowed) {
        return {
          block: true,
          reason: `Plan mode: only the plan_todos Sero CLI command is available. Use /plan to disable first.\nCommand: ${command}`,
        };
      }
    }
  });

  // ── Event: filter stale plan context ───────────────────────

  pi.on('context', async (event) => {
    if (currentMode === 'plan') return;
    return {
      messages: event.messages.filter((m) => {
        const msg = m as unknown as Record<string, unknown>;
        return msg.customType !== 'plan-mode-context';
      }),
    };
  });

  // ── Event: inject plan/execution context ───────────────────

  pi.on('before_agent_start', async () => {
    if (currentMode === 'plan') {
      pi.setActiveTools(PLAN_MODE_TOOLS);
      return {
        message: {
          customType: 'plan-mode-context',
          content: `[PLAN MODE ACTIVE]
You are in plan mode — a read-only exploration mode for safe code analysis.

Restrictions:
- You can only use: read, bash, grep, find, ls, questionnaire, and sero-cli for plan_todos
- You CANNOT use: edit, write (file modifications are disabled)
- Bash is restricted to an allowlist of read-only commands
- Do not run plan_todos through bash; use the sero-cli tool directly

After exploring the codebase, create your plan with the sero-cli tool:
  plan_todos --action set_plan --steps '["Step 1 description", "Step 2 description", ...]'

Do NOT attempt to make changes.
Do NOT execute the plan in this turn.
Do NOT expand the plan into deliverables after saving it.
Your final action must be the sero-cli plan_todos set_plan call. After that tool call succeeds, stop with at most one short sentence saying the plan is saved and waiting for /plan-execute.`,
          display: false,
        },
      };
    }

    if (currentMode === 'execute' && steps.length > 0) {
      const remaining = steps.filter((s) => !s.completed);
      activeExecutionStep = remaining[0]?.step ?? null;
      completedStepDuringTurn = false;
      const list = remaining.map((s) => `${s.step}. ${s.text}`).join('\n');
      return {
        message: {
          customType: 'plan-execution-context',
          content: `[EXECUTING PLAN — Full tool access enabled]

Remaining steps:
${list}

Execute only the first remaining step, then stop.
Before your final response, you MUST use sero-cli: plan_todos --action complete_step --step <number>`, 
          display: false,
        },
      };
    }
  });

  // ── Event: archive + reset on plan completion ──────────────

  pi.on('agent_end', async (_event, ctx) => {
    ensureStatePath(ctx);
    if (currentMode !== 'execute' || steps.length === 0) return;

    if (!completedStepDuringTurn) {
      const autoCompleteStep = activeExecutionStep;
      const firstIncomplete =
        steps.find((s) => s.step === autoCompleteStep && !s.completed) ??
        steps.find((s) => !s.completed);
      if (firstIncomplete) {
        firstIncomplete.completed = true;
        await syncStateToFile();
        persistEntry();
        send('plan-step-complete', `✓ Step ${firstIncomplete.step} completed: ${firstIncomplete.text}`);
      }
    }
    activeExecutionStep = null;
    completedStepDuringTurn = false;

    const next = steps.find((s) => !s.completed);
    if (next) {
      send('plan-mode-next-step', `Continue with step ${next.step}: ${next.text}`, true);
      return;
    }

    await archivePlan();
    send('plan-complete', `**Plan Complete!** ✓`);
    currentMode = 'normal';
    steps = [];
    pi.setActiveTools(NORMAL_MODE_TOOLS);
    await syncStateToFile();
    persistEntry();
  });

  pi.on('session_start', async (_event, ctx) => {
    ensureStatePath(ctx);
    if (pi.getFlag('plan') === true) currentMode = 'plan';

    // Restore from persisted entries
    const entries = ctx.sessionManager.getEntries();
    const planEntry = entries
      .filter(
        (e: { type: string; customType?: string }) =>
          e.type === 'custom' && e.customType === 'plan-mode',
      )
      .pop() as { data?: { mode: PlanMode; steps?: PlanStep[] } } | undefined;

    if (planEntry?.data) {
      const restored = normalizePlanModeState(planEntry.data);
      currentMode = restored.mode;
      steps = restored.steps;
    }

    await syncStateToFile();
  });

  pi.on('session_switch', async (_event, ctx) => {
    ensureStatePath(ctx);
  });
}
