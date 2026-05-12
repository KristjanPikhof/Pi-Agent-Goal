import { describe, expect, it, vi } from "vitest";
import { handleGoalCommand, parseGoalCommand, registerGoalCommand } from "../src/commands.js";
import { GOAL_CUSTOM_TYPE } from "../src/state.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GoalStateEntry } from "../src/types.js";

function createHarness(options: { hasUI?: boolean; confirm?: boolean; editor?: string } = {}) {
	const branch: Array<{ type: string; customType?: string; data?: unknown }> = [];
	const commands = new Map<
		string,
		{ handler: (args: string, ctx: unknown) => Promise<void>; description?: string }
	>();
	const pi = {
		registerCommand: vi.fn((name: string, command) => commands.set(name, command)),
		appendEntry: vi.fn((customType: string, data: unknown) => {
			branch.push({ type: "custom", customType, data });
		}),
		sendUserMessage: vi.fn(),
	} as unknown as ExtensionAPI & { sendUserMessage: ReturnType<typeof vi.fn> };
	const ctx = {
		cwd: process.cwd(),
		hasUI: options.hasUI ?? true,
		sessionManager: { getBranch: vi.fn(() => branch) },
		waitForIdle: vi.fn(async () => undefined),
		ui: {
			notify: vi.fn(),
			confirm: vi.fn(async () => options.confirm ?? true),
			editor: vi.fn(async () => options.editor),
			setStatus: vi.fn(),
			setWidget: vi.fn(),
		},
	};
	return { pi, ctx, branch, commands };
}

function latestGoalEntry(branch: Array<{ data?: unknown }>): GoalStateEntry {
	return branch.at(-1)?.data as GoalStateEntry;
}

describe("parseGoalCommand", () => {
	it("parses show, status, control commands, import, flags, and objectives", () => {
		expect(parseGoalCommand("   ")).toMatchObject({ kind: "show" });
		expect(parseGoalCommand("status")).toMatchObject({ kind: "status" });
		expect(parseGoalCommand("pause")).toMatchObject({ kind: "pause" });
		expect(parseGoalCommand("resume")).toMatchObject({ kind: "resume" });
		expect(parseGoalCommand("clear --yes")).toMatchObject({ kind: "clear", confirmed: true });
		expect(parseGoalCommand("complete -y")).toMatchObject({ kind: "complete", confirmed: true });
		expect(parseGoalCommand("start")).toMatchObject({ kind: "start", start: true });
		expect(parseGoalCommand("import docs/prd.md --start")).toMatchObject({
			kind: "import",
			path: "docs/prd.md",
			start: true,
		});
		expect(parseGoalCommand("ship a long running feature --replace --start")).toMatchObject({
			kind: "create",
			objective: "ship a long running feature",
			replace: true,
			start: true,
		});
		expect(parseGoalCommand("--replace ship a feature -y --unknown")).toMatchObject({
			kind: "create",
			objective: "ship a feature --unknown",
			confirmed: true,
			replace: true,
		});
	});
});

describe("/goal command lifecycle", () => {
	it("registers /goal with command completions", () => {
		const { pi, commands } = createHarness();
		registerGoalCommand(pi);

		expect(commands.has("goal")).toBe(true);
		expect(pi.registerCommand).toHaveBeenCalledWith(
			"goal",
			expect.objectContaining({ description: expect.stringContaining("long-running task") }),
		);
	});

	it("shows usage without waiting for idle when no goal exists", async () => {
		const { pi, ctx } = createHarness();
		await handleGoalCommand(pi, "", ctx);

		expect(ctx.waitForIdle).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Usage:"), "info");
	});

	it("creates an active goal after waiting for idle", async () => {
		const { pi, ctx, branch } = createHarness();
		await handleGoalCommand(pi, "  ship the feature  ", ctx);

		expect(ctx.waitForIdle).toHaveBeenCalledOnce();
		expect(pi.appendEntry).toHaveBeenCalledWith(
			GOAL_CUSTOM_TYPE,
			expect.objectContaining({ action: "create" }),
		);
		expect(latestGoalEntry(branch).state).toMatchObject({ objective: "ship the feature", status: "active" });
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("goal", "goal: active");
	});

	it("starts active goals with a one-shot follow-up prompt", async () => {
		const { pi, ctx } = createHarness();
		await handleGoalCommand(pi, "ship --start", ctx);

		expect(pi.sendUserMessage).toHaveBeenCalledOnce();
		expect(pi.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("Start working toward the active goal now."),
			{ deliverAs: "followUp" },
		);
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("ship"), {
			deliverAs: "followUp",
		});
		expect(ctx.ui.notify).toHaveBeenLastCalledWith("Goal start queued.", "success");
	});

	it("starts an existing active goal and rejects inactive states", async () => {
		const active = createHarness();
		await handleGoalCommand(active.pi, "ship", active.ctx);
		(active.pi.sendUserMessage as ReturnType<typeof vi.fn>).mockClear();
		await handleGoalCommand(active.pi, "start", active.ctx);
		expect(active.pi.sendUserMessage).toHaveBeenCalledOnce();

		const paused = createHarness();
		await handleGoalCommand(paused.pi, "ship", paused.ctx);
		await handleGoalCommand(paused.pi, "pause", paused.ctx);
		(paused.pi.sendUserMessage as ReturnType<typeof vi.fn>).mockClear();
		await handleGoalCommand(paused.pi, "start", paused.ctx);
		expect(paused.pi.sendUserMessage).not.toHaveBeenCalled();
		expect(paused.ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("paused goal"), "error");

		const complete = createHarness({ confirm: true });
		await handleGoalCommand(complete.pi, "ship", complete.ctx);
		await handleGoalCommand(complete.pi, "complete", complete.ctx);
		(complete.pi.sendUserMessage as ReturnType<typeof vi.fn>).mockClear();
		await handleGoalCommand(complete.pi, "start", complete.ctx);
		expect(complete.pi.sendUserMessage).not.toHaveBeenCalled();
		expect(complete.ctx.ui.notify).toHaveBeenLastCalledWith(
			expect.stringContaining("complete goal"),
			"error",
		);
	});

	it("does not start when no goal exists", async () => {
		const { pi, ctx } = createHarness();
		await handleGoalCommand(pi, "start", ctx);

		expect(pi.sendUserMessage).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("No goal exists"), "error");
	});

	it("shows summary and expanded status for an existing goal", async () => {
		const { pi, ctx } = createHarness();
		await handleGoalCommand(pi, "ship", ctx);
		ctx.ui.notify.mockClear();

		await handleGoalCommand(pi, "", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Goal: ship"), "info");

		await handleGoalCommand(pi, "status", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Acceptance criteria:"), "info");
	});

	it("asks confirmation before replacing an existing goal", async () => {
		const { pi, ctx, branch } = createHarness({ confirm: true });
		await handleGoalCommand(pi, "first", ctx);
		await handleGoalCommand(pi, "second", ctx);

		expect(ctx.ui.confirm).toHaveBeenCalledWith(
			"Replace current goal?",
			expect.stringContaining("New: second"),
		);
		expect(latestGoalEntry(branch).action).toBe("replace");
		expect(latestGoalEntry(branch).state?.objective).toBe("second");
	});

	it("requires --replace for non-interactive replacement", async () => {
		const { pi, ctx, branch } = createHarness({ hasUI: false });
		await handleGoalCommand(pi, "first", ctx);
		await handleGoalCommand(pi, "second", ctx);

		expect(latestGoalEntry(branch).state?.objective).toBe("first");
		expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("--replace"), "error");

		await handleGoalCommand(pi, "second --replace", ctx);
		expect(latestGoalEntry(branch).action).toBe("replace");
		expect(latestGoalEntry(branch).state?.objective).toBe("second");
	});

	it("edits in UI mode and rejects edit in no-UI mode", async () => {
		const interactive = createHarness({ editor: "edited objective" });
		await handleGoalCommand(interactive.pi, "original", interactive.ctx);
		await handleGoalCommand(interactive.pi, "edit", interactive.ctx);
		expect(latestGoalEntry(interactive.branch).action).toBe("edit");
		expect(latestGoalEntry(interactive.branch).state?.objective).toBe("edited objective");

		const noUi = createHarness({ hasUI: false });
		await handleGoalCommand(noUi.pi, "original", noUi.ctx);
		await handleGoalCommand(noUi.pi, "edit", noUi.ctx);
		expect(noUi.ctx.ui.notify).toHaveBeenLastCalledWith(
			expect.stringContaining("requires interactive UI"),
			"error",
		);
	});

	it("pauses, resumes, clears, and completes with safe confirmation behavior", async () => {
		const { pi, ctx, branch } = createHarness({ confirm: true });
		await handleGoalCommand(pi, "ship", ctx);
		await handleGoalCommand(pi, "pause", ctx);
		expect(latestGoalEntry(branch).state?.status).toBe("paused");

		await handleGoalCommand(pi, "resume", ctx);
		expect(latestGoalEntry(branch).state?.status).toBe("active");

		await handleGoalCommand(pi, "complete", ctx);
		expect(ctx.ui.confirm).toHaveBeenCalledWith("Mark goal complete?", "ship");
		expect(latestGoalEntry(branch).state?.status).toBe("complete");

		const entriesAfterComplete = branch.length;
		await handleGoalCommand(pi, "resume", ctx);
		expect(branch).toHaveLength(entriesAfterComplete);
		expect(ctx.ui.notify).toHaveBeenLastCalledWith("Only paused goals can be resumed.", "error");

		await handleGoalCommand(pi, "clear", ctx);
		expect(ctx.ui.confirm).toHaveBeenCalledWith("Clear goal?", "ship");
		expect(latestGoalEntry(branch).state).toBeNull();
	});

	it("requires --yes for destructive no-UI commands", async () => {
		const { pi, ctx, branch } = createHarness({ hasUI: false });
		await handleGoalCommand(pi, "ship", ctx);
		await handleGoalCommand(pi, "complete", ctx);
		expect(latestGoalEntry(branch).state?.status).toBe("active");
		expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("requires --yes"), "error");

		await handleGoalCommand(pi, "complete --yes", ctx);
		expect(latestGoalEntry(branch).state?.status).toBe("complete");
	});

	it("refuses to complete paused goals", async () => {
		const { pi, ctx, branch } = createHarness({ confirm: true });
		await handleGoalCommand(pi, "ship", ctx);
		await handleGoalCommand(pi, "pause", ctx);
		const entriesAfterPause = branch.length;

		await handleGoalCommand(pi, "complete", ctx);

		expect(branch).toHaveLength(entriesAfterPause);
		expect(latestGoalEntry(branch).state?.status).toBe("paused");
		expect(ctx.ui.notify).toHaveBeenLastCalledWith("Only active goals can be completed.", "error");
	});
});
