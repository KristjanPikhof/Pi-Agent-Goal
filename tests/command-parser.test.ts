import { describe, expect, it, vi } from "vitest";
import { handleGoalCommand, parseGoalCommand, registerGoalCommand } from "../src/commands.js";
import { GOAL_CUSTOM_TYPE } from "../src/state.js";

import type { GoalProposalGenerator } from "../src/goal-prep.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GoalStateEntry } from "../src/types.js";

function createHarness(
	options: {
		hasUI?: boolean;
		confirm?: boolean;
		select?: Array<string | undefined>;
		editor?: string | string[];
		generateGoalProposal?: GoalProposalGenerator;
	} = {},
) {
	const branch: Array<{ type: string; customType?: string; data?: unknown }> = [];
	const commands = new Map<
		string,
		{ handler: (args: string, ctx: unknown) => Promise<void>; description?: string }
	>();
	const selectResults = [...(options.select ?? [])];
	const editorResults = Array.isArray(options.editor) ? [...options.editor] : undefined;
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
			select: options.select === undefined ? undefined : vi.fn(async () => selectResults.shift()),
			editor: vi.fn(async () => editorResults?.shift() ?? (options.editor as string | undefined)),
			setStatus: vi.fn(),
			setWidget: vi.fn(),
		},
		generateGoalProposal: options.generateGoalProposal,
	};
	return { pi, ctx, branch, commands };
}

function latestGoalEntry(branch: Array<{ data?: unknown }>): GoalStateEntry {
	return branch.at(-1)?.data as GoalStateEntry;
}

function seedGoal(
	branch: Array<{ type: string; customType?: string; data?: unknown }>,
	overrides: Partial<NonNullable<GoalStateEntry["state"]>> = {},
): NonNullable<GoalStateEntry["state"]> {
	const now = Date.now();
	const state: NonNullable<GoalStateEntry["state"]> = {
		version: 1,
		goalId: "goal-1",
		objective: "ship",
		status: "active",
		sourceDocs: [],
		constraints: [],
		acceptanceCriteria: ["Done is verifiable"],
		progress: { done: [], blocked: [], lastSummary: "" },
		createdAt: now,
		updatedAt: now,
		owner: "user",
		...overrides,
	};
	branch.push({ type: "custom", customType: GOAL_CUSTOM_TYPE, data: { action: "create", state } });
	return state;
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

	it("queues a plain goal drafting turn after waiting for idle without saving state", async () => {
		const { pi, ctx, branch } = createHarness({ confirm: false });
		await handleGoalCommand(pi, "  ship the feature  ", ctx);

		expect(ctx.waitForIdle).toHaveBeenCalledOnce();
		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(branch).toHaveLength(0);
		expect(pi.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("Call the propose_goal_draft tool exactly once"),
		);
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("ship the feature"));
		expect(ctx.ui.notify).toHaveBeenCalledWith("Goal draft queued for review.", "success");
	});

	it("carries --start intent into the agent drafting prompt", async () => {
		const { pi, ctx } = createHarness({ confirm: true });
		await handleGoalCommand(pi, "ship interactively --start", ctx);

		expect(ctx.ui.confirm).not.toHaveBeenCalledWith("Start working on this goal now?", "ship interactively");
		expect(pi.sendUserMessage).toHaveBeenCalledOnce();
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("pass start: true"));
	});

	it("queues the same review-only drafting flow in non-interactive mode", async () => {
		const { pi, ctx, branch } = createHarness({ hasUI: false });

		await handleGoalCommand(pi, "ship fallback --start", ctx);

		expect(branch).toHaveLength(0);
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("ship fallback"));
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("pass start: true"));
	});

	it("does not invoke local proposal review or proposal generation from the plain command", async () => {
		const generateGoalProposal = vi.fn<GoalProposalGenerator>(async () => ({
			objective: "Ignored non-public generator",
			acceptanceCriteria: ["Ignored criteria"],
		}));
		const { pi, ctx, branch } = createHarness({ select: ["Cancel"], generateGoalProposal });

		await handleGoalCommand(pi, "ship delegated proposal --start", ctx);

		expect(generateGoalProposal).not.toHaveBeenCalled();
		expect(ctx.ui.select).not.toHaveBeenCalled();
		expect(branch).toHaveLength(0);
		expect(pi.sendUserMessage).toHaveBeenCalledOnce();
	});

	it("prevalidates obvious objective errors before queueing a drafting turn", async () => {
		const { pi, ctx } = createHarness({ confirm: false });

		await handleGoalCommand(pi, "--replace", ctx);

		expect(pi.sendUserMessage).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenLastCalledWith(
			expect.stringContaining("Goal objective must be non-empty"),
			"error",
		);
	});

	it("preserves current-goal replacement context in the queued drafting prompt", async () => {
		const { pi, ctx, branch } = createHarness({ confirm: true });
		seedGoal(branch, { goalId: "existing-goal", objective: "original objective" });

		await handleGoalCommand(pi, "next objective --replace --start", ctx);

		expect(branch).toHaveLength(1);
		expect(ctx.ui.confirm).not.toHaveBeenCalled();
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("replacing an existing goal"));
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("original objective"));
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("pass start: true"));
	});

	it("starts active goals with a one-shot follow-up prompt", async () => {
		const { pi, ctx, branch } = createHarness();
		seedGoal(branch);
		await handleGoalCommand(pi, "start", ctx);

		expect(ctx.ui.confirm).not.toHaveBeenCalledWith("Start working on this goal now?", "ship");
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
		seedGoal(active.branch);
		(active.pi.sendUserMessage as ReturnType<typeof vi.fn>).mockClear();
		await handleGoalCommand(active.pi, "start", active.ctx);
		expect(active.pi.sendUserMessage).toHaveBeenCalledOnce();

		const paused = createHarness();
		seedGoal(paused.branch);
		await handleGoalCommand(paused.pi, "pause", paused.ctx);
		(paused.pi.sendUserMessage as ReturnType<typeof vi.fn>).mockClear();
		await handleGoalCommand(paused.pi, "start", paused.ctx);
		expect(paused.pi.sendUserMessage).not.toHaveBeenCalled();
		expect(paused.ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("paused goal"), "error");

		const complete = createHarness({ confirm: true });
		seedGoal(complete.branch);
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
		const { pi, ctx, branch } = createHarness();
		seedGoal(branch);
		ctx.ui.notify.mockClear();

		await handleGoalCommand(pi, "", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Goal: ship"), "info");

		await handleGoalCommand(pi, "status", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Acceptance criteria:"), "info");
	});

	it("asks confirmation before queueing a replacement drafting turn", async () => {
		const { pi, ctx, branch } = createHarness({ confirm: false });
		seedGoal(branch, { objective: "first" });
		ctx.ui.confirm.mockResolvedValueOnce(true);
		await handleGoalCommand(pi, "second", ctx);

		expect(ctx.ui.confirm).toHaveBeenCalledWith(
			"Replace current goal?",
			expect.stringContaining("New: second"),
		);
		expect(latestGoalEntry(branch).state?.objective).toBe("first");
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("second"));
	});

	it("does not prompt in non-interactive draft creation and carries --start only when explicit", async () => {
		const { pi, ctx, branch } = createHarness({ hasUI: false });
		await handleGoalCommand(pi, "first", ctx);

		expect(branch).toHaveLength(0);
		expect(ctx.ui.confirm).not.toHaveBeenCalled();
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("pass start: false"));

		(pi.sendUserMessage as ReturnType<typeof vi.fn>).mockClear();
		await handleGoalCommand(pi, "second --start", ctx);
		expect(branch).toHaveLength(0);
		expect(ctx.ui.confirm).not.toHaveBeenCalled();
		expect(pi.sendUserMessage).toHaveBeenCalledOnce();
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("pass start: true"));
	});

	it("requires --replace for non-interactive replacement and queues when provided", async () => {
		const { pi, ctx, branch } = createHarness({ hasUI: false });
		seedGoal(branch, { objective: "first" });
		await handleGoalCommand(pi, "second", ctx);

		expect(latestGoalEntry(branch).state?.objective).toBe("first");
		expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("--replace"), "error");

		await handleGoalCommand(pi, "second --replace", ctx);
		expect(latestGoalEntry(branch).state?.objective).toBe("first");
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("pass start: false"));

		(pi.sendUserMessage as ReturnType<typeof vi.fn>).mockClear();
		await handleGoalCommand(pi, "third --replace --start", ctx);
		expect(latestGoalEntry(branch).state?.objective).toBe("first");
		expect(pi.sendUserMessage).toHaveBeenCalledOnce();
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("pass start: true"));
	});

	it("reports unavailable follow-up messaging API without saving", async () => {
		const { pi, ctx, branch } = createHarness({ hasUI: false });
		// Simulate an older API shape at runtime.
		delete (pi as Partial<typeof pi>).sendUserMessage;

		await handleGoalCommand(pi, "intended replacement --start", ctx);

		expect(branch).toHaveLength(0);
		expect(ctx.ui.notify).toHaveBeenLastCalledWith(
			"Cannot draft goal: follow-up messaging API is unavailable.",
			"error",
		);
	});

	it("edits in UI mode and rejects edit in no-UI mode", async () => {
		const interactive = createHarness({ editor: "edited objective" });
		seedGoal(interactive.branch, { objective: "original" });
		await handleGoalCommand(interactive.pi, "edit", interactive.ctx);
		expect(latestGoalEntry(interactive.branch).action).toBe("edit");
		expect(latestGoalEntry(interactive.branch).state?.objective).toBe("edited objective");

		const criteriaEditor = `# Objective
edited objective with criteria

# Acceptance criteria
- First criterion
- Second criterion`;
		const withCriteria = createHarness({ editor: criteriaEditor });
		seedGoal(withCriteria.branch, { objective: "original" });
		await handleGoalCommand(withCriteria.pi, "edit", withCriteria.ctx);
		expect(withCriteria.ctx.ui.editor).toHaveBeenCalledWith(
			"Edit goal",
			expect.stringContaining("# Acceptance criteria"),
		);
		expect(latestGoalEntry(withCriteria.branch).action).toBe("edit");
		expect(latestGoalEntry(withCriteria.branch).state).toMatchObject({
			objective: "edited objective with criteria",
			acceptanceCriteria: ["First criterion", "Second criterion"],
		});

		const emptyCriteria = createHarness({
			editor: "# Objective\ncriteria can be cleared\n\n# Acceptance criteria\n",
		});
		seedGoal(emptyCriteria.branch, { objective: "original" });
		await handleGoalCommand(emptyCriteria.pi, "edit", emptyCriteria.ctx);
		expect(latestGoalEntry(emptyCriteria.branch).state?.acceptanceCriteria).toEqual([]);

		const noUi = createHarness({ hasUI: false });
		seedGoal(noUi.branch, { objective: "original" });
		await handleGoalCommand(noUi.pi, "edit", noUi.ctx);
		expect(noUi.ctx.ui.notify).toHaveBeenLastCalledWith(
			expect.stringContaining("requires interactive UI"),
			"error",
		);
	});

	it("offers start handoff after resume and skips it for pause", async () => {
		const { pi, ctx, branch } = createHarness({ confirm: false });
		seedGoal(branch);
		ctx.ui.confirm.mockClear();
		(pi.sendUserMessage as ReturnType<typeof vi.fn>).mockClear();

		await handleGoalCommand(pi, "pause", ctx);
		expect(ctx.ui.confirm).not.toHaveBeenCalled();
		expect(pi.sendUserMessage).not.toHaveBeenCalled();

		ctx.ui.confirm.mockResolvedValueOnce(true);
		await handleGoalCommand(pi, "resume", ctx);
		expect(ctx.ui.confirm).toHaveBeenCalledWith("Start working on this goal now?", "ship");
		expect(pi.sendUserMessage).toHaveBeenCalledOnce();
	});

	it("pauses, resumes, clears, and completes with safe confirmation behavior", async () => {
		const { pi, ctx, branch } = createHarness({ confirm: true });
		seedGoal(branch);
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
		seedGoal(branch);
		await handleGoalCommand(pi, "complete", ctx);
		expect(latestGoalEntry(branch).state?.status).toBe("active");
		expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("requires --yes"), "error");

		await handleGoalCommand(pi, "complete --yes", ctx);
		expect(latestGoalEntry(branch).state?.status).toBe("complete");
	});

	it("refuses to complete paused goals", async () => {
		const { pi, ctx, branch } = createHarness({ confirm: true });
		seedGoal(branch);
		await handleGoalCommand(pi, "pause", ctx);
		const entriesAfterPause = branch.length;

		await handleGoalCommand(pi, "complete", ctx);

		expect(branch).toHaveLength(entriesAfterPause);
		expect(latestGoalEntry(branch).state?.status).toBe("paused");
		expect(ctx.ui.notify).toHaveBeenLastCalledWith("Only active goals can be completed.", "error");
	});
});
