# Contributing

Thanks for your interest in this Sero plugin.

This repository is maintained under the `sero-labs` organisation. Public contributors should use the standard fork-and-pull-request workflow.

## Pull requests

Please keep PRs focused and include:

- what changed
- why it changed
- how you tested it
- any security, privacy, or compatibility impact

Before opening or updating a PR, run the relevant local checks where available:

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

Some plugins may not have all commands yet. If a command is unavailable, mention that in the PR.

## Safety

Do not commit secrets, API keys, OAuth tokens, private local paths, generated credential files, or machine-specific configuration.

Security issues should follow `SECURITY.md`, not public issues.