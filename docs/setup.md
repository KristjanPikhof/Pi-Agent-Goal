# Setup

This guide installs `pi-agent-goal` as a Pi package and shows the local checkout paths for extension development.

## Requirements

- macOS or Linux
- Node.js `>=22.0.0`
- `@earendil-works/pi-coding-agent ^0.74.0`

## Recommended install

Install the package from npm:

```bash
pi install npm:pi-agent-goal
```

By default, Pi writes this to your global settings at `~/.pi/agent/settings.json`. To install it for the current project only, add `-l`:

```bash
pi install -l npm:pi-agent-goal
```

For a one-off run without writing settings, use:

```bash
pi -e npm:pi-agent-goal
```

After installation, start Pi and run:

```text
/goal
```

You should see the `/goal` command help if no goal exists yet.

## Starting a goal

Setting a goal stores context first. In an interactive Pi session, the goal flow asks whether to start work now. If you choose not to start yet, the active goal still appears in status/widgets and supplies context to later turns.

```text
/goal Ship the onboarding cleanup
/goal start
```

Use `/goal start` when an active goal already exists and you want a one-shot handoff to the agent. This is different from automatic idle continuation; it queues one explicit follow-up turn.

For non-interactive mode, add `--start` to the command that creates, imports, or resumes the goal when you need work to begin immediately:

```bash
pi -e npm:pi-agent-goal -p "/goal Ship the onboarding cleanup --start"
pi -e npm:pi-agent-goal -p "/goal import docs/prd.md --yes --start"
pi -e npm:pi-agent-goal -p "/goal resume --start"
```

Without `--start`, non-interactive create/import/resume commands only update goal state.

## Settings.json form

If you prefer editing settings directly, add the package source to `packages`.

Global, in `~/.pi/agent/settings.json`:

```json
{
	"packages": ["npm:pi-agent-goal"]
}
```

Project-local, in `.pi/settings.json`:

```json
{
	"packages": ["npm:pi-agent-goal"]
}
```

Project settings are local to that workspace. Use them when a repo should always load `pi-agent-goal` for anyone working there.

## Local checkout development

Use a local checkout when you are editing this repository or testing unreleased changes.

```bash
git clone git@github.com:KristjanPikhof/Pi-Agent-Goal.git
cd Pi-Agent-Goal
npm install
```

Then load the source shim directly for a one-off run:

```bash
pi --no-extensions -e ./extensions/index.ts
```

Or link the checkout into your global extension directory:

```bash
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/extensions/index.ts" ~/.pi/agent/extensions/pi-agent-goal.ts
```

For project-local local development, link it under the project:

```bash
mkdir -p /path/to/project/.pi/extensions
ln -s "$PWD/extensions/index.ts" /path/to/project/.pi/extensions/pi-agent-goal.ts
```

## Package entry points

Published and local installs load the source extension entry:

```json
{
	"pi": {
		"extensions": ["./extensions/index.ts"]
	}
}
```

The extension folder mirrors the Pi Agents Team layout:

```text
extensions/index.ts
extensions/pi-goal/index.ts
```

`extensions/index.ts` is the public package entry and re-exports the plugin from `extensions/pi-goal/index.ts`. The nested entry imports the implementation from `src/index.ts`.

For local verification:

```bash
npm run typecheck
npm run lint
npm run format
npm test
npm pack --dry-run
```
