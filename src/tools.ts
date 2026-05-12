import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { loadGoalState, saveGoalState } from "./state.js";
import { renderGoalStatus } from "./ui.js";

import type { GoalProgress, GoalSourceDoc, GoalState } from "./types.js";

export const getGoalParams = Type.Object({}, { additionalProperties: false });
export const createGoalParams = Type.Object(
	{
		objective: Type.String({ description: "The concrete user-approved objective to start pursuing." }),
		explicit_request: Type.Boolean({
			description:
				"Must be true only when the user or system/developer instructions explicitly requested a goal.",
		}),
		source_paths: Type.Optional(
			Type.Array(Type.String(), {
				description: "Optional source paths the user explicitly associated with this goal.",
			}),
		),
		acceptance_criteria: Type.Optional(
			Type.Array(Type.String(), {
				description: "Optional acceptance criteria explicitly provided by the user/system.",
			}),
		),
	},
	{ additionalProperties: false },
);
export const completeGoalParams = Type.Object(
	{
		evidence: Type.Optional(Type.String({ description: "Evidence that the goal is complete." })),
	},
	{ additionalProperties: false },
);
export const updateGoalProgressParams = Type.Object(
	{
		done: Type.Optional(Type.Array(Type.String(), { description: "Completed progress items." })),
		current: Type.Optional(Type.String({ description: "Current work item." })),
		blocked: Type.Optional(Type.Array(Type.String(), { description: "Current blockers." })),
		summary: Type.Optional(Type.String({ description: "Short progress summary." })),
	},
	{ additionalProperties: false },
);

export type CreateGoalToolInput = Static<typeof createGoalParams>;
export type CompleteGoalToolInput = Static<typeof completeGoalParams>;
export type UpdateGoalProgressToolInput = Static<typeof updateGoalProgressParams>;

interface GoalToolContext {
	sessionManager: { getBranch(): Array<{ type: string; customType?: string; data?: unknown }> };
}

type GoalToolResult = {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown> | undefined;
	isError?: boolean;
};

export function registerGoalTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "get_goal",
		label: "Get Goal",
		description: "Get the current long-running goal state and source paths.",
		promptSnippet: "Read the current /goal state, status, progress, acceptance criteria, and source paths.",
		promptGuidelines: [
			"Use get_goal when you need the current long-running objective before acting on goal state.",
		],
		parameters: getGoalParams,
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			return executeGetGoal(ctx as GoalToolContext);
		},
		renderCall: () => new Text(formatGoalToolCall("get_goal"), 0, 0),
		renderResult: (result) => new Text(formatGoalToolResult(result as GoalToolResult), 0, 0),
	});

	pi.registerTool({
		name: "create_goal",
		label: "Create Goal",
		description:
			"Create a goal only when explicitly requested by the user or system/developer instructions. Fails if a goal exists.",
		promptSnippet: "Create a user-approved /goal only when no goal exists.",
		promptGuidelines: [
			"Use create_goal only when the user or system/developer instructions explicitly ask to start a goal; do not infer goals from ordinary tasks.",
			"create_goal fails if a goal already exists; do not use it to rewrite an existing objective.",
		],
		parameters: createGoalParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return executeCreateGoal(params as CreateGoalToolInput, ctx as GoalToolContext, pi);
		},
		renderCall: (args) => new Text(formatGoalToolCall("create_goal", args.objective), 0, 0),
		renderResult: (result) => new Text(formatGoalToolResult(result as GoalToolResult), 0, 0),
	});

	pi.registerTool({
		name: "complete_goal",
		label: "Complete Goal",
		description:
			"Mark the active goal complete only when the objective is achieved and no required work remains.",
		promptSnippet: "Mark the current /goal complete with evidence.",
		promptGuidelines: [
			"Use complete_goal only when the active goal is achieved and no required work remains; include evidence when possible.",
			"complete_goal cannot pause, resume, replace, or rewrite the goal objective.",
		],
		parameters: completeGoalParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return executeCompleteGoal(params as CompleteGoalToolInput, ctx as GoalToolContext, pi);
		},
		renderCall: () => new Text(formatGoalToolCall("complete_goal"), 0, 0),
		renderResult: (result) => new Text(formatGoalToolResult(result as GoalToolResult), 0, 0),
	});

	pi.registerTool({
		name: "update_goal_progress",
		label: "Update Goal Progress",
		description:
			"Update execution progress for the active goal without changing objective, source docs, or criteria.",
		promptSnippet: "Update /goal progress fields only.",
		promptGuidelines: [
			"Use update_goal_progress only for implementation progress; it cannot rewrite objective, source docs, or acceptance criteria.",
		],
		parameters: updateGoalProgressParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return executeUpdateGoalProgress(params as UpdateGoalProgressToolInput, ctx as GoalToolContext, pi);
		},
		renderCall: () => new Text(formatGoalToolCall("update_goal_progress"), 0, 0),
		renderResult: (result) => new Text(formatGoalToolResult(result as GoalToolResult), 0, 0),
	});
}

export function executeGetGoal(ctx: GoalToolContext): GoalToolResult {
	const current = loadGoalState(ctx);
	if (!current) {
		return { content: [{ type: "text", text: "No goal is currently set." }], details: { goal: null } };
	}
	return {
		content: [{ type: "text", text: renderGoalStatus(current) }],
		details: { goal: current, sourcePaths: current.sourceDocs.map((doc) => doc.path) },
	};
}

export function executeCreateGoal(
	params: CreateGoalToolInput,
	ctx: GoalToolContext,
	pi: Pick<ExtensionAPI, "appendEntry">,
): GoalToolResult {
	if (!params.explicit_request) {
		return errorResult(
			"create_goal requires explicit user or system/developer authorization.",
			"permission_denied",
		);
	}
	const current = loadGoalState(ctx);
	if (current) {
		return errorResult(
			"A goal already exists. Use user-owned /goal replacement flow instead.",
			"goal_exists",
			current,
		);
	}
	const next = saveGoalState(
		pi,
		{
			action: "create",
			goalId: crypto.randomUUID(),
			objective: params.objective,
			now: Date.now(),
			owner: "model",
			sourceDocs: sourceDocsFromPaths(params.source_paths),
			acceptanceCriteria: params.acceptance_criteria,
			reason: "Created by create_goal after explicit authorization.",
		},
		current,
	);
	return {
		content: [{ type: "text", text: `Created goal: ${next?.objective ?? params.objective}` }],
		details: { goal: next, sourcePaths: next?.sourceDocs.map((doc) => doc.path) ?? [] },
	};
}

export function executeCompleteGoal(
	params: CompleteGoalToolInput,
	ctx: GoalToolContext,
	pi: Pick<ExtensionAPI, "appendEntry">,
): GoalToolResult {
	const current = loadGoalState(ctx);
	if (!current) return errorResult("No active goal exists to complete.", "no_goal");
	if (current.status === "complete")
		return errorResult("The current goal is already complete.", "already_complete", current);

	const evidence = params.evidence?.trim();
	const next = saveGoalState(
		pi,
		{
			action: "complete",
			goalId: current.goalId,
			now: Date.now(),
			reason: evidence ? `Completed with evidence: ${evidence}` : "Completed by complete_goal.",
		},
		current,
	);
	return {
		content: [{ type: "text", text: evidence ? `Goal complete. Evidence: ${evidence}` : "Goal complete." }],
		details: { goal: next, evidence },
	};
}

export function executeUpdateGoalProgress(
	params: UpdateGoalProgressToolInput,
	ctx: GoalToolContext,
	pi: Pick<ExtensionAPI, "appendEntry">,
): GoalToolResult {
	const current = loadGoalState(ctx);
	if (!current) return errorResult("No active goal exists to update.", "no_goal");
	if (current.status === "complete")
		return errorResult("Cannot update progress for a complete goal.", "already_complete", current);

	const progress: Partial<GoalProgress> = {
		done: params.done,
		current: params.current,
		blocked: params.blocked,
		lastSummary: params.summary,
	};
	const next = saveGoalState(
		pi,
		{
			action: "progress",
			goalId: current.goalId,
			now: Date.now(),
			progress,
			reason: "Updated by update_goal_progress.",
		},
		current,
	);
	return {
		content: [
			{ type: "text", text: `Updated goal progress: ${next?.progress.lastSummary || "progress recorded"}` },
		],
		details: { goal: next, progress: next?.progress },
	};
}

export function formatGoalToolCall(toolName: string, objective?: string): string {
	return objective ? `${toolName}: ${objective}` : toolName;
}

export function formatGoalToolResult(result: GoalToolResult): string {
	const text = result.content.find((block) => block.type === "text")?.text ?? "";
	return result.isError ? `Error: ${text}` : text;
}

function errorResult(message: string, code: string, goal?: GoalState): GoalToolResult {
	return { content: [{ type: "text", text: message }], details: { error: code, goal }, isError: true };
}

function sourceDocsFromPaths(paths?: string[]): GoalSourceDoc[] {
	return (paths ?? []).map((path) => ({
		path,
		kind: "manual",
		brief: "Source path explicitly provided when creating the goal.",
		extractedAt: Date.now(),
	}));
}
