import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import goalExtension from "../src/index.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function createPiStub() {
	const commands = new Map<
		string,
		{
			description?: string;
			handler: (args: string, ctx: { ui: { notify: ReturnType<typeof vi.fn> } }) => Promise<void>;
		}
	>();
	const pi = {
		registerCommand: vi.fn((name, options) => {
			commands.set(name, options);
		}),
		registerTool: vi.fn(),
		on: vi.fn(),
	} as unknown as ExtensionAPI;

	return { pi, commands };
}

describe("goalExtension", () => {
	it("registers a loadable /goal command", () => {
		const { pi, commands } = createPiStub();
		goalExtension(pi);

		expect(commands.has("goal")).toBe(true);
		expect(pi.registerCommand).toHaveBeenCalledWith(
			"goal",
			expect.objectContaining({ description: expect.stringContaining("long-running task") }),
		);
	});

	it("keeps package metadata aligned with Pi package and docs load expectations", () => {
		const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
			name: string;
			main: string;
			exports: Record<string, string>;
			pi: { extensions: string[] };
			files: string[];
			devDependencies: Record<string, string>;
			peerDependencies: Record<string, string>;
			scripts: Record<string, string>;
		};

		expect(packageJson.name).toBe("pi-agent-goal");
		expect(packageJson.main).toBe("./extensions/index.ts");
		expect(packageJson.exports["."]).toBe("./extensions/index.ts");
		expect(packageJson.pi.extensions).toEqual(["./extensions/index.ts"]);
		expect(packageJson.files).toEqual(expect.arrayContaining(["extensions", "src", "docs", "README.md"]));
		expect(packageJson.devDependencies).toMatchObject({
			"@earendil-works/pi-coding-agent": "^0.80.10",
			"@earendil-works/pi-tui": "^0.80.10",
		});
		expect(packageJson.peerDependencies).toMatchObject({
			"@earendil-works/pi-coding-agent": ">=0.80.5 <0.81.0",
			"@earendil-works/pi-tui": ">=0.79.3 <0.81.0",
			typebox: "*",
		});
		expect(packageJson.scripts).toMatchObject({
			"smoke:pi:goal": expect.stringContaining("tests/smoke-pi.mjs goal"),
			"smoke:pi:goal-continuation": expect.stringContaining("tests/smoke-pi.mjs continuation"),
			"smoke:package": expect.stringContaining("tests/package-smoke.mjs"),
			"test:coverage": expect.stringContaining("--coverage"),
		});
	});
});
