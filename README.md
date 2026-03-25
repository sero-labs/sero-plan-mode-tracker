# @sero-ai/plugin-plan-mode

Plan mode for Sero — read-only code exploration with progress-tracked plan
execution.

## What It Does

Plan mode restricts the agent to read-only tools so it can safely explore a
codebase, build a step-by-step plan, then execute it with full tool access and
live progress tracking.

### Modes

| Mode | Tools | Description |
|---------|---------------|----------------------------------------------|
| Normal | Full access | Default — no restrictions |
| Plan | Read-only | Bash is filtered to an allowlist of safe commands. Agent creates a numbered plan via `plan_todos`. |
| Execute | Full access | Agent works through plan steps in order, marking each done via `plan_todos`. |

### Commands

| Command | Description |
|-----------------|--------------------------------------|
| `/plan` | Toggle plan mode on / off |
| `/plan-execute` | Start executing the current plan |
| `/plan-todos` | Show current plan progress in chat |

### Skill: Plan Exit Review

Bundled skill (`skills/plan-exit-review/SKILL.md`) that provides a thorough
plan review workflow before implementation — challenges scope, architecture,
code quality, tests, and performance.

## Sero Plugin Install

Install in **Sero → Admin → Plugins** with:

```text
git:https://github.com/monobyte/sero-plan-mode-tracker.git
```

Sero clones the source repo, installs dependencies, builds the UI, and
hot-loads the plugin into the sidebar.

## Pi CLI Usage

Install as a Pi package:

```bash
pi install git:https://github.com/monobyte/sero-plan-mode-tracker.git
```

The agent gains the `plan_todos` tool, `/plan`, `/plan-execute`, and
`/plan-todos` commands, plus the `--plan` flag for starting in plan mode.

## Development

```bash
npm install
npm run build        # Build UI → dist/ui/remoteEntry.js
npm run typecheck    # Typecheck UI (zero errors required)
npm run dev          # Dev server on port 5180
```

## State File

```
workspace-root/
└── .sero/
    └── apps/
        └── planmode/
            ├── state.json      # Current mode + steps
            ├── index.json      # Archive manifest
            └── plan-*.json     # Archived completed plans
```

```json
{
  "mode": "plan",
  "steps": [
    { "step": 1, "text": "Analyse the auth module", "completed": false },
    { "step": 2, "text": "Refactor token validation", "completed": false }
  ]
}
```

Both the Pi extension (write) and web UI (read via `useAppState`) share
this file. Changes from the agent are reflected instantly in the UI.
