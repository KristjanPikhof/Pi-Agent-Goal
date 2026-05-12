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
});
