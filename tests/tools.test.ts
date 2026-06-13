import { describe, expect, it, vi } from "vitest";
import {
	completeGoalParams,
	createGoalParams,
	executeCompleteGoal,
	executeCreateGoal,
	executeGetGoal,
	executeProposeGoalDraft,
	executeUpdateGoalProgress,
	formatCompleteGoalToolResult,
	formatGoalToolCall,
	formatGoalToolResult,
	formatProposeGoalDraftToolCall,
	formatUpdateGoalProgressToolCall,
	getGoalParams,
	proposeGoalDraftParams,
	proposeGoalDraftPromptGuidelines,
	proposeGoalDraftPromptSnippet,
	registerGoalTools,
	updateGoalProgressParams,
} from "../src/tools.js";
import { saveGoalState } from "../src/state.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GoalStateEntry } from "../src/types.js";

function createHarness() {
	const branch: Array<{ type: string; customType?: string; data?: unknown }> = [];
	const tools = new Map<
		string,
		{
			name: string;
			parameters: unknown;
			promptSnippet?: string;
			promptGuidelines?: string[];
			execute: (...args: never[]) => Promise<unknown>;
			renderCall?: (
				args: Record<string, unknown>,
				theme?: { fg: (token: string, text: string) => string; bold: (text: string) => string },
			) => { render(width: number): string[] };
			renderResult?: (
				result: Record<string, unknown>,
				options?: Record<string, unknown>,
				theme?: { fg: (token: string, text: string) => string; bold: (text: string) => string },
			) => { render(width: number): string[] };
		}
	>();
	const pi = {
		registerTool: vi.fn((tool) => tools.set(tool.name, tool)),
		appendEntry: vi.fn((customType: string, data: unknown) =>
			branch.push({ type: "custom", customType, data }),
		),
	} as unknown as ExtensionAPI;
	const ui = {
		notify: vi.fn(),
		confirm: vi.fn(async () => true),
		select: vi.fn(async () => "Start"),
		editor: vi.fn(),
		setStatus: vi.fn(),
		setWidget: vi.fn(),
	};
	const ctx = { hasUI: true, sessionManager: { getBranch: vi.fn(() => branch) }, ui };
	return { branch, tools, pi, ctx, ui };
}

function latestGoalEntry(branch: Array<{ data?: unknown }>): GoalStateEntry {
	return branch.at(-1)?.data as GoalStateEntry;
}

describe("goal tool schemas and registration", () => {
	it("defines narrow schemas and registers all goal tools", () => {
		expect((getGoalParams as { additionalProperties?: boolean }).additionalProperties).toBe(false);
		expect(Object.keys(createGoalParams.properties)).toEqual([
			"objective",
			"explicit_request",
			"source_paths",
			"acceptance_criteria",
		]);
		expect(Object.keys(completeGoalParams.properties)).toEqual(["evidence"]);
		expect(Object.keys(updateGoalProgressParams.properties)).toEqual([
			"done",
			"current",
			"blocked",
			"summary",
		]);

		const { pi, tools } = createHarness();
		registerGoalTools(pi);
		expect(Object.keys(proposeGoalDraftParams.properties)).toEqual([
			"objective",
			"description",
			"acceptanceCriteria",
			"sourcePaths",
			"startImmediately",
			"draftId",
			"commandId",
		]);
		expect([...tools.keys()]).toEqual([
			"get_goal",
			"create_goal",
			"propose_goal_draft",
			"complete_goal",
			"update_goal_progress",
		]);
		expect(pi.registerTool).toHaveBeenCalledTimes(5);
	});

	it("documents propose_goal_draft as the review-only drafting path separate from create_goal", () => {
		expect(proposeGoalDraftPromptSnippet).toContain("Use propose_goal_draft");
		expect(proposeGoalDraftPromptSnippet).toContain("do not persist");
		expect(proposeGoalDraftPromptGuidelines).toEqual(
			expect.arrayContaining([
				expect.stringContaining("Use propose_goal_draft for plain /goal drafting turns"),
				expect.stringContaining("Preserve the user's meaning and boundaries"),
				expect.stringContaining("editable acceptanceCriteria"),
				expect.stringContaining("Do not leave acceptanceCriteria empty"),
				expect.stringContaining("Call propose_goal_draft exactly once"),
				expect.stringContaining("create_goal persists an already-approved goal"),
			]),
		);

		const { pi, tools } = createHarness();
		registerGoalTools(pi);
		const createGoalGuidance = tools.get("create_goal")?.promptGuidelines?.join("\n") ?? "";
		expect(createGoalGuidance).toContain("persist an already-approved goal");
		expect(createGoalGuidance).toContain("Do not use create_goal for agent-drafted /goal proposals");
		expect(createGoalGuidance).toContain("use propose_goal_draft");

		for (const toolName of [
			"get_goal",
			"create_goal",
			"propose_goal_draft",
			"complete_goal",
			"update_goal_progress",
		]) {
			const tool = tools.get(toolName);
			expect(tool?.promptSnippet).toContain(toolName);
			expect(tool?.promptGuidelines?.join("\n")).toContain(toolName);
		}
	});
});

describe("goal tool execution", () => {
	it("get_goal returns no-goal and current state details including source paths", () => {
		const { pi, ctx, branch } = createHarness();
		expect(executeGetGoal(ctx)).toMatchObject({ details: { goal: null } });

		executeCreateGoal(
			{
				objective: "Ship tools",
				explicit_request: true,
				source_paths: ["docs/prd.md"],
				acceptance_criteria: ["tools pass"],
			},
			ctx,
			pi,
		);
		const result = executeGetGoal(ctx);
		expect(result.content[0].text).toContain("Goal: Ship tools");
		expect(result.details).toMatchObject({ sourcePaths: ["docs/prd.md"] });
		expect(latestGoalEntry(branch).state?.acceptanceCriteria).toEqual(["tools pass"]);
	});

	it("create_goal soft-refuses without explicit authorization and when a goal exists", () => {
		const { pi, ctx, branch, ui } = createHarness();
		const denied = executeCreateGoal({ objective: "No permission", explicit_request: false }, ctx, pi);
		expect(denied).toMatchObject({ details: { status: "refused", reason: "permission_denied" } });
		expect(denied).not.toHaveProperty("isError");
		expect(branch).toHaveLength(0);

		const created = executeCreateGoal({ objective: "Allowed", explicit_request: true }, ctx, pi);
		expect(created.isError).toBeUndefined();
		expect(latestGoalEntry(branch).action).toBe("create");
		expect(ui.setStatus).toHaveBeenCalledWith("goal", undefined);
		expect(ui.setWidget).toHaveBeenCalledWith(
			"goal",
			expect.arrayContaining(["Goal · Active · AC: 0 · Allowed"]),
		);

		const duplicate = executeCreateGoal({ objective: "Rewrite", explicit_request: true }, ctx, pi);
		expect(duplicate).toMatchObject({ details: { status: "refused", reason: "goal_exists" } });
		expect(duplicate).not.toHaveProperty("isError");
		expect(latestGoalEntry(branch).state?.objective).toBe("Allowed");
	});

	it("propose_goal_draft saves and starts only after Start review", async () => {
		const { pi, ctx, branch, ui } = createHarness();
		const sendUserMessage = vi.fn();
		const result = await executeProposeGoalDraft(
			{
				objective: " Ship reviewed goal ",
				acceptanceCriteria: [" done ", "done", " tests pass "],
				sourcePaths: [" docs/prd.md "],
				draftId: " draft-1 ",
				commandId: " command-1 ",
			},
			ctx,
			{ ...pi, sendUserMessage },
		);

		expect(ui.select).toHaveBeenCalledWith("Review generated goal proposal", ["Start", "Edit", "Cancel"]);
		expect(latestGoalEntry(branch).action).toBe("create");
		expect(latestGoalEntry(branch).state).toMatchObject({
			objective: "Ship reviewed goal",
			acceptanceCriteria: ["done", "tests pass"],
			sourceDocs: [expect.objectContaining({ path: "docs/prd.md" })],
		});
		expect(sendUserMessage).toHaveBeenCalledOnce();
		expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Ship reviewed goal"), {
			deliverAs: "followUp",
		});
		expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("- done"), {
			deliverAs: "followUp",
		});
		expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("- tests pass"), {
			deliverAs: "followUp",
		});
		expect(result).toMatchObject({
			terminate: true,
			details: {
				status: "saved",
				action: "create",
				started: true,
				draftId: "draft-1",
				commandId: "command-1",
			},
		});
	});

	it("propose_goal_draft supports Edit review and retries invalid edits", async () => {
		const { pi, ctx, branch, ui } = createHarness();
		const sendUserMessage = vi.fn();
		ui.select.mockResolvedValueOnce("Edit").mockResolvedValueOnce("Edit").mockResolvedValueOnce("Start");
		ui.editor
			.mockResolvedValueOnce("# Acceptance criteria\n- missing objective")
			.mockResolvedValueOnce("# Objective\nEdited goal\n\n# Acceptance criteria\n- edited criterion");

		const result = await executeProposeGoalDraft(
			{ objective: "Initial", acceptanceCriteria: ["initial criterion"] },
			ctx,
			{ ...pi, sendUserMessage },
		);

		expect(ui.notify).toHaveBeenCalledWith("Goal draft must include a non-empty Objective section.", "error");
		expect(ui.editor).toHaveBeenCalledTimes(2);
		expect(latestGoalEntry(branch).state).toMatchObject({
			objective: "Edited goal",
			acceptanceCriteria: ["edited criterion"],
		});
		expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Edited goal"), {
			deliverAs: "followUp",
		});
		expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("- edited criterion"), {
			deliverAs: "followUp",
		});
		expect(result.details).toMatchObject({ status: "saved", started: true });
	});

	it("propose_goal_draft cancellation and no-UI policy do not save", async () => {
		const cancelled = createHarness();
		cancelled.ui.select.mockResolvedValueOnce("Cancel");
		const cancelResult = await executeProposeGoalDraft(
			{ objective: "Cancel me", acceptanceCriteria: ["criterion"] },
			cancelled.ctx,
			cancelled.pi,
		);
		expect(cancelled.branch).toHaveLength(0);
		expect(cancelResult).toMatchObject({
			terminate: true,
			details: { status: "cancelled", reason: "user_cancelled" },
		});

		const noUi = createHarness();
		const noUiCtx = { ...noUi.ctx, hasUI: false };
		const noUiResult = await executeProposeGoalDraft(
			{ objective: "No UI", acceptanceCriteria: ["criterion"] },
			noUiCtx,
			noUi.pi,
		);
		expect(noUi.branch).toHaveLength(0);
		expect(noUiResult).toMatchObject({
			terminate: true,
			details: { status: "cancelled", reason: "review_ui_unavailable" },
		});
	});

	it("propose_goal_draft confirms existing goal replacement and rejects stale state", async () => {
		const denied = createHarness();
		denied.ui.confirm.mockResolvedValueOnce(false);
		executeCreateGoal({ objective: "Old goal", explicit_request: true }, denied.ctx, denied.pi);
		const deniedResult = await executeProposeGoalDraft(
			{ objective: "Denied replacement", acceptanceCriteria: ["new criterion"] },
			denied.ctx,
			{ ...denied.pi, sendUserMessage: vi.fn() },
		);
		expect(denied.branch).toHaveLength(1);
		expect(latestGoalEntry(denied.branch).state?.objective).toBe("Old goal");
		expect(deniedResult).toMatchObject({
			terminate: true,
			details: { status: "cancelled", reason: "replacement_not_confirmed" },
		});

		const replace = createHarness();
		executeCreateGoal({ objective: "Old goal", explicit_request: true }, replace.ctx, replace.pi);
		const replacement = await executeProposeGoalDraft(
			{ objective: "New goal", acceptanceCriteria: ["new criterion"] },
			replace.ctx,
			{ ...replace.pi, sendUserMessage: vi.fn() },
		);
		expect(replace.ui.confirm).toHaveBeenCalledWith(
			"Replace current goal?",
			expect.stringContaining("Old goal"),
		);
		expect(latestGoalEntry(replace.branch).action).toBe("replace");
		expect(latestGoalEntry(replace.branch).state?.objective).toBe("New goal");
		expect(replacement.details).toMatchObject({ status: "saved", action: "replace" });

		const stale = createHarness();
		stale.ui.select.mockImplementationOnce(async () => {
			executeCreateGoal({ objective: "Concurrent goal", explicit_request: true }, stale.ctx, stale.pi);
			return "Start";
		});
		await expect(
			executeProposeGoalDraft(
				{ objective: "Stale draft", acceptanceCriteria: ["criterion"] },
				stale.ctx,
				{ ...stale.pi, sendUserMessage: vi.fn() },
			),
		).rejects.toMatchObject({ message: "Goal changed before saving. No goal was saved.", code: "stale_goal" });
		expect(latestGoalEntry(stale.branch).state?.objective).toBe("Concurrent goal");
	});

	it("propose_goal_draft throws for invalid model-provided draft shape before review", async () => {
		const { pi, ctx, branch, ui } = createHarness();
		await expect(
			executeProposeGoalDraft({ objective: "   ", acceptanceCriteria: [" "] }, ctx, pi),
		).rejects.toMatchObject({ message: "Goal draft objective is required.", code: "invalid_objective" });
		expect(branch).toHaveLength(0);
		expect(ui.select).not.toHaveBeenCalled();
	});

	it("complete_goal handles no-goal cases and persists evidence without rewriting scope", () => {
		const empty = createHarness();
		expect(executeCompleteGoal({ evidence: "done" }, empty.ctx, empty.pi)).toMatchObject({
			details: { status: "refused", reason: "no_goal" },
		});

		const { pi, ctx, branch, ui } = createHarness();
		executeCreateGoal(
			{ objective: "Complete me", explicit_request: true, acceptance_criteria: ["criterion"] },
			ctx,
			pi,
		);
		const result = executeCompleteGoal({ evidence: "all criteria passed" }, ctx, pi);

		expect(ui.setStatus).toHaveBeenCalledWith("goal", undefined);
		expect(ui.setWidget).toHaveBeenCalledWith("goal", undefined);
		expect(result.content[0].text).toContain("Evidence: all criteria passed");
		expect(latestGoalEntry(branch).action).toBe("complete");
		expect(latestGoalEntry(branch).reason).toContain("all criteria passed");
		expect(latestGoalEntry(branch).state).toMatchObject({
			objective: "Complete me",
			acceptanceCriteria: ["criterion"],
			status: "complete",
		});
	});

	it("update_goal_progress only mutates progress fields", () => {
		const { pi, ctx, branch, ui } = createHarness();
		executeCreateGoal(
			{
				objective: "Track me",
				explicit_request: true,
				source_paths: ["docs/a.md"],
				acceptance_criteria: ["a"],
			},
			ctx,
			pi,
		);
		const result = executeUpdateGoalProgress(
			{ done: ["one"], current: "two", blocked: ["three"], summary: "progress summary" },
			ctx,
			pi,
		);

		expect(result.content[0].text).toBe("Goal progress updated");
		expect(formatGoalToolResult(result)).toBe("Goal progress updated");
		expect(ui.setStatus).toHaveBeenLastCalledWith("goal", undefined);
		expect(ui.setWidget).toHaveBeenLastCalledWith(
			"goal",
			expect.arrayContaining(["Goal · Active · AC: 1 · Blocked: 1 · Track me", "Now · two"]),
		);
		expect(latestGoalEntry(branch).action).toBe("progress");
		expect(latestGoalEntry(branch).state).toMatchObject({
			objective: "Track me",
			acceptanceCriteria: ["a"],
			sourceDocs: [expect.objectContaining({ path: "docs/a.md" })],
			progress: { done: ["one"], current: "two", blocked: ["three"], lastSummary: "progress summary" },
		});
	});

	it("complete_goal and update_goal_progress reject paused goals", () => {
		const { pi, ctx, branch } = createHarness();
		executeCreateGoal({ objective: "Paused", explicit_request: true }, ctx, pi);
		saveGoalState(
			pi,
			{ action: "pause", goalId: latestGoalEntry(branch).state?.goalId ?? "", now: Date.now() },
			latestGoalEntry(branch).state,
		);

		expect(executeCompleteGoal({ evidence: "done" }, ctx, pi)).toMatchObject({
			details: { status: "refused", reason: "goal_inactive" },
		});
		expect(executeUpdateGoalProgress({ summary: "late" }, ctx, pi)).toMatchObject({
			details: { status: "refused", reason: "goal_inactive" },
		});
		expect(latestGoalEntry(branch).state?.status).toBe("paused");
	});

	it("update_goal_progress fails with no goal or complete goal", () => {
		const empty = createHarness();
		expect(executeUpdateGoalProgress({ summary: "x" }, empty.ctx, empty.pi)).toMatchObject({
			details: { status: "refused", reason: "no_goal" },
		});

		const { pi, ctx } = createHarness();
		executeCreateGoal({ objective: "Done", explicit_request: true }, ctx, pi);
		executeCompleteGoal({ evidence: "done" }, ctx, pi);
		expect(executeUpdateGoalProgress({ summary: "late" }, ctx, pi)).toMatchObject({
			details: { status: "refused", reason: "already_complete" },
		});
	});
});

describe("goal tool renderers", () => {
	it("formats tool calls as human-readable title/body displays", () => {
		expect(formatGoalToolCall("create_goal", "Ship it")).toBe("Create goal\nShip it");
		expect(formatGoalToolCall("get_goal")).toBe("Get goal");
		expect(formatGoalToolCall("complete_goal", "all checks passed")).toBe(
			"✓ Complete goal\nall checks passed",
		);
		expect(
			formatProposeGoalDraftToolCall({
				objective: "Review branch",
				acceptanceCriteria: ["Review the diff", "Report risks"],
			}),
		).toBe(
			"Propose goal draft\nObjective: Review branch\nAcceptance criteria:\n- Review the diff\n- Report risks",
		);
		expect(
			formatUpdateGoalProgressToolCall({
				summary:
					"Core implementation is complete; one integration test still expects the previous widget format.",
				current: "Fix renderer test",
			}),
		).toBe(
			"Update goal progress\nCore implementation is complete; one integration test still expects the previous widget format.",
		);
		expect(formatUpdateGoalProgressToolCall({ current: "Fix renderer test" })).toBe(
			"Update goal progress\nFix renderer test",
		);
		expect(formatUpdateGoalProgressToolCall({ done: ["implementation", "tests"] })).toBe(
			"Update goal progress\nDone: implementation; tests",
		);
	});

	it("registered update_goal_progress renderCall includes summary args without legacy prefix", () => {
		const { pi, tools } = createHarness();
		registerGoalTools(pi);

		const rendered = tools
			.get("update_goal_progress")
			?.renderCall?.({
				summary:
					"Core implementation is complete; one integration test still expects the previous widget format.",
			})
			.render(120)
			.map((line) => line.trim())
			.filter(Boolean);

		expect(rendered).toEqual([
			"Update goal progress",
			"Core implementation is complete; one integration test still expects the previous widget format.",
		]);
		expect(rendered?.join("\n")).not.toContain("Updated goal progress:");
	});

	it("registered complete_goal renderers show evidence once in the call display", () => {
		const { pi, tools } = createHarness();
		registerGoalTools(pi);

		const callRendered = tools
			.get("complete_goal")
			?.renderCall?.({ evidence: "Reviewed branch compact-goal-widget-ui against likely base main." })
			.render(120)
			.map((line) => line.trim())
			.filter(Boolean);
		const resultRendered = tools
			.get("complete_goal")
			?.renderResult?.({
				content: [
					{
						type: "text",
						text: "Goal complete. Evidence: Reviewed branch compact-goal-widget-ui against likely base main.",
					},
				],
				details: { evidence: "Reviewed branch compact-goal-widget-ui against likely base main." },
			})
			.render(120)
			.map((line) => line.trim())
			.filter(Boolean);

		expect(callRendered).toEqual([
			"✓ Complete goal",
			"Reviewed branch compact-goal-widget-ui against likely base main.",
		]);
		expect(resultRendered).toEqual([]);
	});

	it("formats tool results concisely", () => {
		expect(
			formatCompleteGoalToolResult({
				content: [{ type: "text", text: "Goal complete. Evidence: all checks passed" }],
				details: { evidence: "all checks passed" },
			}),
		).toBe("");
		expect(
			formatCompleteGoalToolResult({
				content: [{ type: "text", text: "No active goal exists to complete." }],
				details: { error: "no_goal" },
				isError: true,
			}),
		).toBe("Error: No active goal exists to complete.");
		expect(
			formatGoalToolResult({
				content: [{ type: "text", text: "Goal progress updated" }],
				details: { progress: { lastSummary: "already shown in the action body" } },
			}),
		).toBe("Goal progress updated");
		expect(
			formatGoalToolResult({
				content: [{ type: "text", text: "Denied" }],
				details: undefined,
				isError: true,
			}),
		).toBe("Error: Denied");
	});
});
