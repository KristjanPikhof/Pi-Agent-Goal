# Setup

Use this guide to install `pi-agent-goal` or load a local checkout while developing the extension.

## Requirements

- macOS or Linux.
- Node.js `>=22.19.0`.
- `pi-agent-goal` release `2026.6.13`.
- A Pi host compatible with `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` `^0.79.3` APIs.

The published package declares Pi packages as open peer dependencies (`*`). That lets the extension use the host Pi runtime instead of bundling another copy.

## Install from npm

Global install:

```bash
pi install npm:pi-agent-goal
```

Project-local install:

```bash
pi install -l npm:pi-agent-goal
```

One-off run without writing settings:

```bash
pi -e npm:pi-agent-goal
```

Then start Pi and check the command:

```text
/goal
```

With no saved goal, you should see command help.

## Start a goal

Interactive flow:

```text
/goal Ship the onboarding cleanup
```

Plain goal text asks the chat agent to call `propose_goal_draft`. The TUI review then offers Start, Edit, and Cancel. Start saves and queues one agent handoff. Edit opens a prefilled markdown editor. Cancel saves nothing.

To start an already active goal:

```text
/goal start
```

This queues one explicit handoff. It is not automatic idle continuation.

## Non-interactive starts

Use import or resume when a non-interactive run should save state and start immediately:

```bash
pi -e npm:pi-agent-goal -p "/goal import docs/prd.md --yes --start"
pi -e npm:pi-agent-goal -p "/goal resume --start"
```

Plain `/goal <objective> --start` in non-interactive mode only queues the draft/review path. It does not persist or start work by itself.

## Settings.json form

Global settings live at `~/.pi/agent/settings.json`:

```json
{
	"packages": ["npm:pi-agent-goal"]
}
```

Project settings live at `.pi/settings.json`:

```json
{
	"packages": ["npm:pi-agent-goal"]
}
```

Use project settings when a repo should always load the extension.

## Local checkout development

```bash
git clone git@github.com:KristjanPikhof/Pi-Agent-Goal.git
cd Pi-Agent-Goal
npm install
pi --no-extensions -e ./extensions/index.ts
```

To link the checkout globally:

```bash
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/extensions/index.ts" ~/.pi/agent/extensions/pi-agent-goal.ts
```

To link it into another project:

```bash
mkdir -p /path/to/project/.pi/extensions
ln -s "$PWD/extensions/index.ts" /path/to/project/.pi/extensions/pi-agent-goal.ts
```

## Package entry point

Published and local installs load the source extension entry:

```json
{
	"pi": {
		"extensions": ["./extensions/index.ts"]
	}
}
```

Layout:

```text
extensions/index.ts
extensions/pi-goal/index.ts
```

`extensions/index.ts` re-exports the plugin from `extensions/pi-goal/index.ts`, which imports the implementation from `src/index.ts`.

## Package policy

Keep `README.md`, `docs`, `extensions`, `src`, and `LICENSE` in the npm package. Keep docs links relative so they work after `npm pack` and on GitHub.

Check package contents with:

```bash
npm pack --dry-run
npm run smoke:package
```

## Local verification

The canonical release list lives in [`acceptance-criteria.md`](acceptance-criteria.md#validation-commands).

```bash
npm run typecheck
npm run lint
npm run format
npm test
npm run test:coverage
npm run smoke:pi
npm run smoke:package
npm pack --dry-run
```
