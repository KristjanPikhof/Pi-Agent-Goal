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
		const { pi, ctx, branch } = createHarness({ confirm: false });
		await handleGoalCommand(pi, "  ship the feature  ", ctx);

		expect(ctx.waitForIdle).toHaveBeenCalledOnce();
		expect(pi.appendEntry).toHaveBeenCalledWith(
			GOAL_CUSTOM_TYPE,
			expect.objectContaining({ action: "create" }),
		);
		expect(latestGoalEntry(branch).state).toMatchObject({ objective: "ship the feature", status: "active" });
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("goal", "goal: active");
		expect(ctx.ui.confirm).toHaveBeenCalledWith("Start working on this goal now?", "ship the feature");
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("offers start handoff after create and queues it when accepted", async () => {
		const { pi, ctx } = createHarness({ confirm: true });
		await handleGoalCommand(pi, "ship interactively", ctx);

		expect(ctx.ui.confirm).toHaveBeenCalledWith("Start working on this goal now?", "ship interactively");
		expect(pi.sendUserMessage).toHaveBeenCalledOnce();
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("ship interactively"), {
			deliverAs: "followUp",
		});
	});

	it("uses a real-Pi supported criteria-free draft when no proposal API exists", async () => {
		const { pi, ctx, branch } = createHarness({ hasUI: false });

		await handleGoalCommand(pi, "ship fallback --start", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("No acceptance criteria were provided"),
			"warning",
		);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Objective: ship fallback"), "info");
		expect(latestGoalEntry(branch).state).toMatchObject({
			objective: "ship fallback",
			acceptanceCriteria: [],
		});
		expect(pi.sendUserMessage).toHaveBeenCalledOnce();
	});

	it("reviews criteria-free drafts with Start/Edit/Cancel select flow and starts edited criteria", async () => {
		const editedDraft = `# Objective
Edited generated proposal

# Acceptance criteria
- Edited criterion
- Start prompt uses edited criteria`;
		const { pi, ctx, branch } = createHarness({
			select: ["Edit", "Start"],
			editor: editedDraft,
		});

		await handleGoalCommand(pi, "ship edited proposal", ctx);

		expect(ctx.ui.select).toHaveBeenCalledWith("Review generated goal proposal", ["Start", "Edit", "Cancel"]);
		expect(ctx.ui.editor).toHaveBeenCalledWith(
			"Edit goal proposal",
			expect.stringContaining("ship edited proposal"),
		);
		expect(latestGoalEntry(branch).state).toMatchObject({
			objective: "Edited generated proposal",
			acceptanceCriteria: ["Edited criterion", "Start prompt uses edited criteria"],
		});
		expect(pi.sendUserMessage).toHaveBeenCalledOnce();
		expect(pi.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("Start prompt uses edited criteria"),
			{ deliverAs: "followUp" },
		);
	});

	it("notifies on invalid modal edit content and returns to proposal review", async () => {
		const validDraft = `# Objective
Recovered proposal

# Acceptance criteria
- Valid after retry`;
		const { pi, ctx, branch } = createHarness({
			select: ["Edit", "Edit", "Start"],
			editor: ["# Acceptance criteria\n- missing objective", validDraft],
		});

		await handleGoalCommand(pi, "ship retry proposal", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Objective section"), "error");
		expect(ctx.ui.select).toHaveBeenCalledTimes(3);
		expect(latestGoalEntry(branch).state).toMatchObject({
			objective: "Recovered proposal",
			acceptanceCriteria: ["Valid after retry"],
		});
	});

	it("falls back when hasUI is true but select is unavailable", async () => {
		const generateGoalProposal = vi.fn<GoalProposalGenerator>(async () => ({
			objective: "Ignored non-public generator",
			acceptanceCriteria: ["Ignored criteria"],
		}));
		const { pi, ctx, branch } = createHarness({ confirm: false, generateGoalProposal });

		await handleGoalCommand(pi, "ship no select shape", ctx);

		expect(generateGoalProposal).not.toHaveBeenCalled();
		expect(latestGoalEntry(branch).state).toMatchObject({
			objective: "ship no select shape",
			acceptanceCriteria: [],
		});
		expect(ctx.ui.confirm).toHaveBeenCalledWith("Start working on this goal now?", "ship no select shape");
	});

	it("cancels generated proposal review without saving or starting", async () => {
		const generateGoalProposal = vi.fn<GoalProposalGenerator>(async () => ({
			objective: "Generated but cancelled",
			acceptanceCriteria: ["Should not persist"],
		}));
		const { pi, ctx, branch } = createHarness({ select: ["Cancel"], generateGoalProposal });

		await handleGoalCommand(pi, "ship cancelled proposal --start", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith("Goal proposal cancelled; no goal was saved.", "info");
		expect(branch).toHaveLength(0);
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("does not queue duplicate start follow-ups after denied handoff or command errors", async () => {
		const { pi, ctx } = createHarness({ confirm: false });

		await handleGoalCommand(pi, "ship later", ctx);
		expect(ctx.ui.confirm).toHaveBeenCalledWith("Start working on this goal now?", "ship later");
		expect(pi.sendUserMessage).not.toHaveBeenCalled();

		await handleGoalCommand(pi, "--replace", ctx);

		expect(pi.sendUserMessage).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenLastCalledWith(
			expect.stringContaining("Goal objective must be non-empty"),
			"error",
		);
	});

	it("does not start when the goal changes while create start confirmation is pending", async () => {
		const { pi, ctx, branch } = createHarness({ confirm: false });
		await handleGoalCommand(pi, "original", ctx);
		ctx.ui.confirm.mockClear();
		ctx.ui.confirm.mockResolvedValueOnce(true).mockImplementationOnce(async () => {
			ctx.hasUI = false;
			await handleGoalCommand(pi, "replacement --replace --yes", ctx);
			ctx.hasUI = true;
			return true;
		});

		await handleGoalCommand(pi, "next", ctx);

		expect(branch).toHaveLength(3);
		expect(latestGoalEntry(branch).state?.objective).toBe("replacement");
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenLastCalledWith(
			expect.stringContaining("Goal changed before starting"),
			"error",
		);
	});

	it("starts active goals with a one-shot follow-up prompt", async () => {
		const { pi, ctx } = createHarness();
		await handleGoalCommand(pi, "ship --start", ctx);

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

	it("asks confirmation before replacing an existing goal and then offers start handoff", async () => {
		const { pi, ctx, branch } = createHarness({ confirm: false });
		await handleGoalCommand(pi, "first", ctx);
		ctx.ui.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
		await handleGoalCommand(pi, "second", ctx);

		expect(ctx.ui.confirm).toHaveBeenCalledWith(
			"Replace current goal?",
			expect.stringContaining("New: second"),
		);
		expect(ctx.ui.confirm).toHaveBeenCalledWith("Start working on this goal now?", "second");
		expect(latestGoalEntry(branch).action).toBe("replace");
		expect(latestGoalEntry(branch).state?.objective).toBe("second");
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("does not prompt or start non-interactive creates unless --start is explicit", async () => {
		const { pi, ctx, branch } = createHarness({ hasUI: false });
		await handleGoalCommand(pi, "first", ctx);

		expect(latestGoalEntry(branch).state?.objective).toBe("first");
		expect(ctx.ui.confirm).not.toHaveBeenCalled();
		expect(pi.sendUserMessage).not.toHaveBeenCalled();

		await handleGoalCommand(pi, "second --replace --start", ctx);
		expect(latestGoalEntry(branch).state?.objective).toBe("second");
		expect(ctx.ui.confirm).not.toHaveBeenCalled();
		expect(pi.sendUserMessage).toHaveBeenCalledOnce();
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("second"), {
			deliverAs: "followUp",
		});
	});

	it("requires --replace for non-interactive replacement and only starts with --start", async () => {
		const { pi, ctx, branch } = createHarness({ hasUI: false });
		await handleGoalCommand(pi, "first", ctx);
		await handleGoalCommand(pi, "second", ctx);

		expect(latestGoalEntry(branch).state?.objective).toBe("first");
		expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("--replace"), "error");

		await handleGoalCommand(pi, "second --replace", ctx);
		expect(latestGoalEntry(branch).action).toBe("replace");
		expect(latestGoalEntry(branch).state?.objective).toBe("second");
		expect(pi.sendUserMessage).not.toHaveBeenCalled();

		await handleGoalCommand(pi, "third --replace --start", ctx);
		expect(latestGoalEntry(branch).state?.objective).toBe("third");
		expect(pi.sendUserMessage).toHaveBeenCalledOnce();
	});

	it("aborts stale --replace when the goal changes before save", async () => {
		const { pi, ctx, branch } = createHarness({ hasUI: false });
		await handleGoalCommand(pi, "original", ctx);
		(pi.sendUserMessage as ReturnType<typeof vi.fn>).mockClear();
		ctx.ui.notify.mockClear();
		const entriesBeforeReplace = branch.length;
		const externalState = {
			...latestGoalEntry(branch).state!,
			goalId: "external-goal",
			objective: "external replacement",
			updatedAt: Date.now(),
		};
		let reads = 0;
		ctx.sessionManager.getBranch.mockImplementation(() => {
			reads += 1;
			if (reads === 2) {
				branch.push({
					type: "custom",
					customType: GOAL_CUSTOM_TYPE,
					data: {
						action: "replace",
						state: externalState,
						event: {
							action: "replace",
							goalId: externalState.goalId,
							objective: externalState.objective,
							now: externalState.updatedAt,
							owner: "user",
						},
					},
				});
			}
			return branch;
		});

		await handleGoalCommand(pi, "intended replacement --replace --start", ctx);

		expect(branch).toHaveLength(entriesBeforeReplace + 1);
		expect(latestGoalEntry(branch).state?.objective).toBe("external replacement");
		expect(ctx.ui.notify).toHaveBeenLastCalledWith(
			"Goal changed before saving. Re-run /goal with your objective.",
			"error",
		);
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("edits in UI mode and rejects edit in no-UI mode", async () => {
		const interactive = createHarness({ editor: "edited objective" });
		await handleGoalCommand(interactive.pi, "original", interactive.ctx);
		await handleGoalCommand(interactive.pi, "edit", interactive.ctx);
		expect(latestGoalEntry(interactive.branch).action).toBe("edit");
		expect(latestGoalEntry(interactive.branch).state?.objective).toBe("edited objective");

		const criteriaEditor = `# Objective
edited objective with criteria

# Acceptance criteria
- First criterion
- Second criterion`;
		const withCriteria = createHarness({ editor: criteriaEditor });
		await handleGoalCommand(withCriteria.pi, "original", withCriteria.ctx);
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
		await handleGoalCommand(emptyCriteria.pi, "original", emptyCriteria.ctx);
		await handleGoalCommand(emptyCriteria.pi, "edit", emptyCriteria.ctx);
		expect(latestGoalEntry(emptyCriteria.branch).state?.acceptanceCriteria).toEqual([]);

		const noUi = createHarness({ hasUI: false });
		await handleGoalCommand(noUi.pi, "original", noUi.ctx);
		await handleGoalCommand(noUi.pi, "edit", noUi.ctx);
		expect(noUi.ctx.ui.notify).toHaveBeenLastCalledWith(
			expect.stringContaining("requires interactive UI"),
			"error",
		);
	});

	it("offers start handoff after resume and skips it for pause", async () => {
		const { pi, ctx } = createHarness({ confirm: false });
		await handleGoalCommand(pi, "ship", ctx);
		ctx.ui.confirm.mockClear();

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
