import { describe, expect, it, vi } from "vitest";
import {
	completeGoalParams,
	createGoalParams,
	executeCompleteGoal,
	executeCreateGoal,
	executeGetGoal,
	executeUpdateGoalProgress,
	formatGoalToolCall,
	formatGoalToolResult,
	getGoalParams,
	registerGoalTools,
	updateGoalProgressParams,
} from "../src/tools.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GoalStateEntry } from "../src/types.js";

function createHarness() {
	const branch: Array<{ type: string; customType?: string; data?: unknown }> = [];
	const tools = new Map<
		string,
		{ name: string; parameters: unknown; execute: (...args: never[]) => Promise<unknown> }
	>();
	const pi = {
		registerTool: vi.fn((tool) => tools.set(tool.name, tool)),
		appendEntry: vi.fn((customType: string, data: unknown) =>
			branch.push({ type: "custom", customType, data }),
		),
	} as unknown as ExtensionAPI;
	const ctx = { sessionManager: { getBranch: vi.fn(() => branch) } };
	return { branch, tools, pi, ctx };
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
		expect([...tools.keys()]).toEqual(["get_goal", "create_goal", "complete_goal", "update_goal_progress"]);
		expect(pi.registerTool).toHaveBeenCalledTimes(4);
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

	it("create_goal fails without explicit authorization and when a goal exists", () => {
		const { pi, ctx, branch } = createHarness();
		const denied = executeCreateGoal({ objective: "No permission", explicit_request: false }, ctx, pi);
		expect(denied).toMatchObject({ isError: true, details: { error: "permission_denied" } });
		expect(branch).toHaveLength(0);

		const created = executeCreateGoal({ objective: "Allowed", explicit_request: true }, ctx, pi);
		expect(created.isError).toBeUndefined();
		expect(latestGoalEntry(branch).action).toBe("create");

		const duplicate = executeCreateGoal({ objective: "Rewrite", explicit_request: true }, ctx, pi);
		expect(duplicate).toMatchObject({ isError: true, details: { error: "goal_exists" } });
		expect(latestGoalEntry(branch).state?.objective).toBe("Allowed");
	});

	it("complete_goal handles no-goal cases and persists evidence without rewriting scope", () => {
		const empty = createHarness();
		expect(executeCompleteGoal({ evidence: "done" }, empty.ctx, empty.pi)).toMatchObject({
			isError: true,
			details: { error: "no_goal" },
		});

		const { pi, ctx, branch } = createHarness();
		executeCreateGoal(
			{ objective: "Complete me", explicit_request: true, acceptance_criteria: ["criterion"] },
			ctx,
			pi,
		);
		const result = executeCompleteGoal({ evidence: "all criteria passed" }, ctx, pi);

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
		const { pi, ctx, branch } = createHarness();
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

		expect(result.content[0].text).toContain("progress summary");
		expect(latestGoalEntry(branch).action).toBe("progress");
		expect(latestGoalEntry(branch).state).toMatchObject({
			objective: "Track me",
			acceptanceCriteria: ["a"],
			sourceDocs: [expect.objectContaining({ path: "docs/a.md" })],
			progress: { done: ["one"], current: "two", blocked: ["three"], lastSummary: "progress summary" },
		});
	});

	it("update_goal_progress fails with no goal or complete goal", () => {
		const empty = createHarness();
		expect(executeUpdateGoalProgress({ summary: "x" }, empty.ctx, empty.pi)).toMatchObject({
			isError: true,
			details: { error: "no_goal" },
		});

		const { pi, ctx } = createHarness();
		executeCreateGoal({ objective: "Done", explicit_request: true }, ctx, pi);
		executeCompleteGoal({ evidence: "done" }, ctx, pi);
		expect(executeUpdateGoalProgress({ summary: "late" }, ctx, pi)).toMatchObject({
			isError: true,
			details: { error: "already_complete" },
		});
	});
});

describe("goal tool renderers", () => {
	it("formats tool calls and results concisely", () => {
		expect(formatGoalToolCall("create_goal", "Ship it")).toBe("create_goal: Ship it");
		expect(formatGoalToolCall("get_goal")).toBe("get_goal");
		expect(
			formatGoalToolResult({ content: [{ type: "text", text: "Goal complete." }], details: undefined }),
		).toBe("Goal complete.");
		expect(
			formatGoalToolResult({
				content: [{ type: "text", text: "Denied" }],
				details: undefined,
				isError: true,
			}),
		).toBe("Error: Denied");
	});
});
