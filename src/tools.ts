import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import {
	confirmGoalReplacement,
	reviewGoalProposal,
	saveReviewedGoalAndOfferStart,
	type GoalStartAPI,
	type GoalWorkflowContext,
} from "./commands.js";
import { loadGoalState, saveGoalState, validateObjective } from "./state.js";
import { applyGoalUi, renderGoalStatus } from "./ui.js";

import type { GoalDraftProposal } from "./goal-prep.js";
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
export const proposeGoalDraftParams = Type.Object(
	{
		objective: Type.String({ description: "The concise objective for the proposed /goal draft." }),
		description: Type.Optional(
			Type.String({
				description:
					"Optional short context summary for result metadata; not persisted unless folded into objective or acceptance criteria.",
			}),
		),
		acceptanceCriteria: Type.Array(Type.String(), {
			description: "Concrete, editable completion checks directly implied by the user's request.",
			minItems: 1,
		}),
		sourcePaths: Type.Optional(
			Type.Array(Type.String(), {
				description: "Optional source paths explicitly associated with this goal draft.",
			}),
		),
		startImmediately: Type.Optional(
			Type.Boolean({ description: "True when the draft should offer Start as the intended action." }),
		),
		draftId: Type.Optional(Type.String({ description: "Optional model-generated draft correlation id." })),
		commandId: Type.Optional(Type.String({ description: "Optional /goal drafting command correlation id." })),
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

export const proposeGoalDraftPromptSnippet =
	"Draft a reviewable /goal proposal and call propose_goal_draft exactly once; do not persist it directly.";

export const proposeGoalDraftPromptGuidelines = [
	"Use propose_goal_draft for plain /goal drafting turns that need user review before anything is saved.",
	"Preserve the user's meaning and boundaries; do not invent unrelated scope or silently drop constraints.",
	"Provide objective and editable acceptanceCriteria with concrete completion checks directly implied by the request; include description only as optional non-persisted context metadata.",
	"Do not leave acceptanceCriteria empty for the drafting flow; if details are uncertain, make the uncertainty explicit rather than creating unrelated checks.",
	"Call propose_goal_draft exactly once instead of replying with the draft in prose.",
	"Do not use create_goal for this flow: create_goal persists an already-approved goal after explicit authorization, while propose_goal_draft only opens review.",
] as const;

export type CreateGoalToolInput = Static<typeof createGoalParams>;
export type ProposeGoalDraftToolInput = Static<typeof proposeGoalDraftParams>;
export type CompleteGoalToolInput = Static<typeof completeGoalParams>;
export type UpdateGoalProgressToolInput = Static<typeof updateGoalProgressParams>;

interface GoalToolContext extends Partial<GoalWorkflowContext> {
	sessionManager: { getBranch(): Array<{ type: string; customType?: string; data?: unknown }> };
}

type GoalToolResult = {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown> | undefined;
	isError?: boolean;
	terminate?: boolean;
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
			"Use create_goal only when the user or system/developer instructions explicitly ask to persist an already-approved goal; do not infer goals from ordinary tasks.",
			"Do not use create_goal for agent-drafted /goal proposals; use propose_goal_draft so the user can review objective and acceptance criteria first.",
			"create_goal fails if a goal already exists; do not use it to rewrite an existing objective.",
		],
		parameters: createGoalParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return executeCreateGoal(params as CreateGoalToolInput, ctx as GoalToolContext, pi);
		},
		renderCall: (args) =>
			new Text(
				formatGoalToolCall("create_goal", (args as Partial<CreateGoalToolInput> | undefined)?.objective),
				0,
				0,
			),
		renderResult: (result) => new Text(formatGoalToolResult(result as GoalToolResult), 0, 0),
	});

	pi.registerTool({
		name: "propose_goal_draft",
		label: "Propose Goal Draft",
		description:
			"Open a structured /goal draft for user review. Saves only after the user chooses Start in the review UI.",
		promptSnippet: proposeGoalDraftPromptSnippet,
		promptGuidelines: [...proposeGoalDraftPromptGuidelines],
		parameters: proposeGoalDraftParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return executeProposeGoalDraft(params as ProposeGoalDraftToolInput, ctx as GoalToolContext, pi);
		},
		renderCall: (args) => new Text(formatProposeGoalDraftToolCall(args as ProposeGoalDraftToolInput), 0, 0),
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
		renderCall: (args) =>
			new Text(
				formatGoalToolCall("complete_goal", (args as Partial<CompleteGoalToolInput> | undefined)?.evidence),
				0,
				0,
			),
		renderResult: (result) => new Text(formatCompleteGoalToolResult(result as GoalToolResult), 0, 0),
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
		renderCall: (args) =>
			new Text(formatUpdateGoalProgressToolCall(args as UpdateGoalProgressToolInput), 0, 0),
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
	applyGoalUi(ctx, next);
	return {
		content: [{ type: "text", text: `Created goal: ${next?.objective ?? params.objective}` }],
		details: { goal: next, sourcePaths: next?.sourceDocs.map((doc) => doc.path) ?? [] },
	};
}

export async function executeProposeGoalDraft(
	params: ProposeGoalDraftToolInput,
	ctx: GoalToolContext,
	pi: Pick<ExtensionAPI, "appendEntry"> & Partial<GoalStartAPI>,
): Promise<GoalToolResult> {
	const normalized = normalizeGoalDraftParams(params);
	if (!normalized.ok) return errorResult(normalized.message, normalized.code, undefined, true);

	if (!ctx.hasUI || !ctx.ui?.select || !ctx.ui.editor) {
		return {
			content: [
				{
					type: "text",
					text: "Goal draft requires interactive review before saving. No goal was saved.",
				},
			],
			details: { status: "cancelled", reason: "review_ui_unavailable", goal: null },
			terminate: true,
		};
	}

	const current = loadGoalState(ctx);
	const action = await confirmGoalReplacement(
		ctx as GoalWorkflowContext,
		current,
		false,
		normalized.proposal.objective,
	);
	if (!action) {
		return {
			content: [{ type: "text", text: "Goal draft cancelled. No goal was saved." }],
			details: { status: "cancelled", reason: "replacement_not_confirmed", goal: current },
			terminate: true,
		};
	}

	const review = await reviewGoalProposal(ctx as GoalWorkflowContext, normalized.proposal);
	if (!review) {
		return {
			content: [{ type: "text", text: "Goal draft cancelled. No goal was saved." }],
			details: { status: "cancelled", reason: "user_cancelled", goal: current },
			terminate: true,
		};
	}

	const reviewed = normalizeReviewedProposal(review.proposal);
	if (!reviewed.ok) return errorResult(reviewed.message, reviewed.code, current ?? undefined, true);

	const next = await saveReviewedGoalAndOfferStart(
		pi as ExtensionAPI & Partial<GoalStartAPI>,
		ctx as GoalWorkflowContext,
		{
			current,
			proposal: reviewed.proposal,
			action,
			start: true,
			sourceDocs: sourceDocsFromPaths(normalized.sourcePaths),
			successMessage:
				action === "replace" ? "Goal draft accepted and replaced." : "Goal draft accepted and saved.",
			staleMessage: "Goal changed before saving. Re-run /goal draft for the current goal.",
		},
	);
	if (!next) {
		return errorResult(
			"Goal changed before saving. No goal was saved.",
			"stale_goal",
			current ?? undefined,
			true,
		);
	}

	return {
		content: [{ type: "text", text: `Saved goal draft and queued Start: ${next.objective}` }],
		details: {
			status: "saved",
			action,
			started: true,
			goal: next,
			draftId: normalized.draftId,
			commandId: normalized.commandId,
		},
		terminate: true,
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
	if (current.status !== "active")
		return errorResult("Only active goals can be completed.", "goal_inactive", current);

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
	applyGoalUi(ctx, next);
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
	if (current.status !== "active")
		return errorResult("Only active goals can receive progress updates.", "goal_inactive", current);

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
	applyGoalUi(ctx, next);
	return {
		content: [{ type: "text", text: "Goal progress updated" }],
		details: { goal: next, progress: next?.progress },
	};
}

export function formatGoalToolCall(toolName: string, body?: string): string {
	const title = goalToolTitle(toolName);
	const normalizedBody = body?.trim();
	return normalizedBody ? `${title}\n${normalizedBody}` : title;
}

export function formatProposeGoalDraftToolCall(input: ProposeGoalDraftToolInput): string {
	const lines = [`Objective: ${input.objective}`];
	const criteria = normalizeStringList(input.acceptanceCriteria);
	if (criteria.length > 0) {
		lines.push("Acceptance criteria:", ...criteria.map((item) => `- ${item}`));
	}
	return formatGoalToolCall("propose_goal_draft", lines.join("\n"));
}

export function formatUpdateGoalProgressToolCall(input?: Partial<UpdateGoalProgressToolInput>): string {
	return formatGoalToolCall("update_goal_progress", formatGoalProgressCallBody(input));
}

export function formatGoalToolResult(result: GoalToolResult): string {
	const text = result.content.find((block) => block.type === "text")?.text ?? "";
	return result.isError ? `Error: ${text}` : text;
}

export function formatCompleteGoalToolResult(result: GoalToolResult): string {
	return result.isError ? formatGoalToolResult(result) : "";
}

function errorResult(message: string, code: string, goal?: GoalState, terminate = false): GoalToolResult {
	return {
		content: [{ type: "text", text: message }],
		details: { error: code, goal },
		isError: true,
		terminate,
	};
}

function goalToolTitle(toolName: string): string {
	switch (toolName) {
		case "get_goal":
			return "Get goal";
		case "create_goal":
			return "Create goal";
		case "propose_goal_draft":
			return "Propose goal draft";
		case "complete_goal":
			return "✓ Complete goal";
		case "update_goal_progress":
			return "Update goal progress";
		default:
			return toolName;
	}
}

function formatGoalProgressCallBody(input?: Partial<UpdateGoalProgressToolInput>): string | undefined {
	const summary = input?.summary?.trim();
	if (summary) return summary;
	const current = input?.current?.trim();
	if (current) return current;
	const done = normalizeStringList(input?.done);
	if (done.length > 0) return `Done: ${done.join("; ")}`;
	const blocked = normalizeStringList(input?.blocked);
	if (blocked.length > 0) return `Blocked: ${blocked.join("; ")}`;
	return undefined;
}

function normalizeGoalDraftParams(
	params: ProposeGoalDraftToolInput,
):
	| { ok: true; proposal: GoalDraftProposal; sourcePaths?: string[]; draftId?: string; commandId?: string }
	| { ok: false; code: string; message: string } {
	const objective = safeValidateObjective(params.objective);
	if (!objective)
		return { ok: false, code: "invalid_objective", message: "Goal draft objective is required." };
	const acceptanceCriteria = normalizeStringList(params.acceptanceCriteria);
	if (acceptanceCriteria.length === 0) {
		return {
			ok: false,
			code: "invalid_acceptance_criteria",
			message: "Goal draft must include at least one non-empty acceptance criterion.",
		};
	}
	return {
		ok: true,
		proposal: { objective, acceptanceCriteria },
		sourcePaths: normalizeStringList(params.sourcePaths),
		draftId: params.draftId?.trim() || undefined,
		commandId: params.commandId?.trim() || undefined,
	};
}

function normalizeReviewedProposal(
	proposal: GoalDraftProposal,
): { ok: true; proposal: GoalDraftProposal } | { ok: false; code: string; message: string } {
	const objective = safeValidateObjective(proposal.objective);
	if (!objective)
		return { ok: false, code: "invalid_objective", message: "Edited goal objective is required." };
	const acceptanceCriteria = normalizeStringList(proposal.acceptanceCriteria);
	if (acceptanceCriteria.length === 0) {
		return {
			ok: false,
			code: "invalid_acceptance_criteria",
			message: "Edited goal draft must include at least one acceptance criterion.",
		};
	}
	return { ok: true, proposal: { objective, acceptanceCriteria } };
}

function normalizeStringList(values?: string[]): string[] {
	return [...new Set((values ?? []).map((item) => item.trim()).filter((item) => item.length > 0))];
}

function safeValidateObjective(value: string): string | null {
	try {
		return validateObjective(value);
	} catch {
		return null;
	}
}

function sourceDocsFromPaths(paths?: string[]): GoalSourceDoc[] {
	return (paths ?? []).map((path) => ({
		path,
		kind: "manual",
		brief: "Source path explicitly provided when creating the goal.",
		extractedAt: Date.now(),
	}));
}
