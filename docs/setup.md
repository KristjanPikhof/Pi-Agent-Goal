# Setup

This guide installs `pi-goal` as a Pi package and shows the local checkout paths for extension development.

## Requirements

- macOS or Linux
- Node.js `>=22.0.0`
- `@earendil-works/pi-coding-agent ^0.74.0`

## Recommended install

Install the package from npm:

```bash
pi install npm:pi-goal
```

By default, Pi writes this to your global settings at `~/.pi/agent/settings.json`. To install it for the current project only, add `-l`:

```bash
pi install -l npm:pi-goal
```

For a one-off run without writing settings, use:

```bash
pi -e npm:pi-goal
```

After installation, start Pi and run:

```text
/goal
```

You should see the `/goal` command help if no goal exists yet.

## Settings.json form

If you prefer editing settings directly, add the package source to `packages`.

Global, in `~/.pi/agent/settings.json`:

```json
{
	"packages": ["npm:pi-goal"]
}
```

Project-local, in `.pi/settings.json`:

```json
{
	"packages": ["npm:pi-goal"]
}
```

Project settings are local to that workspace. Use them when a repo should always load `pi-goal` for anyone working there.

## Local checkout development

Use a local checkout when you are editing this repository or testing unreleased changes.

```bash
git clone <pi-goal-repo-url>
cd pi-goal
npm install
npm run build
```

Then load the source shim directly for a one-off run:

```bash
pi --no-extensions -e ./extensions/index.ts
```

Or link the checkout into your global extension directory:

```bash
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/extensions/index.ts" ~/.pi/agent/extensions/pi-goal.ts
```

For project-local local development, link it under the project:

```bash
mkdir -p /path/to/project/.pi/extensions
ln -s "$PWD/extensions/index.ts" /path/to/project/.pi/extensions/pi-goal.ts
```

## Package entry points

Published installs load the built extension entry:

```json
{
	"pi": {
		"extensions": ["./dist/extensions/index.js"]
	}
}
```

The package also exposes its library entry from `./dist/index.js` for tests or embedding:

```ts
import goalExtension from "pi-goal";
```

## Build before packing

`npm pack` and `npm publish` run `prepack`, which calls `npm run build:publish`. That removes `dist`, compiles the TypeScript sources with `tsconfig.publish.json`, and writes the built Pi extension shim to `dist/extensions/index.js`.

For local verification:

```bash
npm run typecheck
npm run lint
npm test
npm run build:publish
npm pack --dry-run
```
