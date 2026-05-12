import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { preparePlainGoalDraft, type GoalDraftProposal } from "./goal-prep.js";
import { importGoalSources, parseEditableGoalDraft, renderEditableGoalDraft } from "./import.js";
import { renderGoalStartPrompt } from "./prompts.js";
import { loadGoalState, saveGoalState, validateObjective } from "./state.js";
import {
	applyGoalUi,
	GOAL_USAGE,
	noGoalMessage,
	nonInteractiveConfirmationMessage,
	renderGoalStatus,
	renderGoalSummary,
} from "./ui.js";

import type { GoalState, GoalStateEvent } from "./types.js";

export type GoalCommandKind =
	| "show"
	| "status"
	| "create"
	| "edit"
	| "pause"
	| "resume"
	| "start"
	| "clear"
	| "complete"
	| "import";

export interface ParsedGoalCommand {
	kind: GoalCommandKind;
	objective?: string;
	path?: string;
	confirmed: boolean;
	replace: boolean;
	start: boolean;
}

interface GoalCommandContext {
	cwd: string;
	hasUI: boolean;
	sessionManager: { getBranch(): Array<{ type: string; customType?: string; data?: unknown }> };
	waitForIdle(): Promise<void>;
	ui: {
		notify(message: string, level?: "info" | "success" | "warning" | "error"): void;
		confirm(title: string, message: string): Promise<boolean>;
		select?(title: string, options: string[]): Promise<string | undefined>;
		editor(title: string, initialValue: string): Promise<string | undefined>;
		setStatus(key: string, value: string | undefined): void;
		setWidget(key: string, value: string[] | undefined): void;
	};
}

interface GoalStartAPI {
	sendUserMessage(message: string, options?: { deliverAs?: "followUp" | "steer" }): unknown;
}

const CONTROL_COMMANDS = new Set([
	"status",
	"edit",
	"pause",
	"resume",
	"start",
	"clear",
	"complete",
	"import",
]);
const RECOGNIZED_FLAGS = new Set(["--yes", "-y", "--replace", "--start"]);

export function registerGoalCommand(pi: ExtensionAPI): void {
	pi.registerCommand("goal", {
		description: "Set or view the goal for a long-running task",
		getArgumentCompletions: (prefix) => {
			const items = [...CONTROL_COMMANDS].filter((command) => command.startsWith(prefix));
			return items.length > 0 ? items.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => handleGoalCommand(pi, args, ctx as GoalCommandContext),
	});
}

export async function handleGoalCommand(
	pi: ExtensionAPI,
	args: string,
	ctx: GoalCommandContext,
): Promise<void> {
	const parsed = parseGoalCommand(args);

	if (parsed.kind === "show" || parsed.kind === "status") {
		const current = loadGoalState(ctx);
		if (!current) {
			ctx.ui.notify(GOAL_USAGE, "info");
			updateGoalUi(ctx, null);
			return;
		}
		ctx.ui.notify(parsed.kind === "status" ? renderGoalStatus(current) : renderGoalSummary(current), "info");
		updateGoalUi(ctx, current);
		return;
	}

	if (parsed.kind === "import") {
		await importGoal(pi, ctx, parsed);
		return;
	}

	await ctx.waitForIdle();
	const current = loadGoalState(ctx);

	try {
		switch (parsed.kind) {
			case "create":
				await createOrReplaceGoal(pi, ctx, parsed, current);
				return;
			case "start":
				await startActiveGoal(pi, ctx, current?.goalId);
				return;
			case "edit":
				await editGoal(pi, ctx, current);
				return;
			case "pause":
				mutateExistingGoal(pi, ctx, current, "pause", "Goal paused.");
				return;
			case "resume": {
				const next = mutateExistingGoal(pi, ctx, current, "resume", "Goal resumed.");
				if (next) await offerGoalStartHandoff(pi, ctx, next.goalId, parsed.start);
				return;
			}
			case "clear":
				await confirmThenMutate(pi, ctx, current, "clear", parsed.confirmed, "Clear goal?", "Goal cleared.");
				return;
			case "complete":
				await confirmThenMutate(
					pi,
					ctx,
					current,
					"complete",
					parsed.confirmed,
					"Mark goal complete?",
					"Goal marked complete.",
				);
				return;
		}
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
	}
}

export function parseGoalCommand(args: string): ParsedGoalCommand {
	const trimmed = args.trim();
	if (!trimmed) return { kind: "show", confirmed: false, replace: false, start: false };

	const tokens = trimmed.split(/\s+/);
	const [first = ""] = tokens;
	const flags = new Set(tokens.filter((token) => token.startsWith("-")));
	const confirmed = flags.has("--yes") || flags.has("-y");
	const replace = flags.has("--replace");
	const start = flags.has("--start");

	if (first === "status") return { kind: "status", confirmed, replace, start };
	if (first === "edit") return { kind: "edit", confirmed, replace, start };
	if (first === "pause") return { kind: "pause", confirmed, replace, start };
	if (first === "resume") return { kind: "resume", confirmed, replace, start };
	if (first === "start") return { kind: "start", confirmed, replace, start: true };
	if (first === "clear") return { kind: "clear", confirmed, replace, start };
	if (first === "complete") return { kind: "complete", confirmed, replace, start };
	if (first === "import") {
		const pathArg = tokens
			.slice(1)
			.filter((token) => !token.startsWith("-"))
			.join(" ")
			.trim();
		return { kind: "import", path: pathArg, confirmed, replace, start };
	}

	const objective = tokens
		.filter((token) => !RECOGNIZED_FLAGS.has(token))
		.join(" ")
		.trim();
	return { kind: "create", objective, confirmed, replace, start };
}

async function importGoal(
	pi: ExtensionAPI,
	ctx: GoalCommandContext,
	parsed: ParsedGoalCommand,
): Promise<void> {
	await ctx.waitForIdle();
	try {
		const current = loadGoalState(ctx);
		if (current && current.status !== "active") {
			ctx.ui.notify(
				`Cannot import docs into a ${current.status} goal. Run /goal resume first, or /goal clear --yes before creating a new goal from docs.`,
				"error",
			);
			return;
		}

		const imported = await importGoalSources(parsed.path ?? "", { cwd: ctx.cwd });
		const summary = [
			`Objective: ${imported.objective}`,
			`Source docs: ${imported.sourceDocs.map((doc) => doc.path).join(", ")}`,
			`Acceptance criteria: ${imported.acceptanceCriteria.length}`,
			`Constraints: ${imported.constraints.length}`,
			`Risks: ${imported.risks.length}`,
			`Open questions: ${imported.openQuestions.length}`,
		].join("\n");

		if (!parsed.confirmed) {
			if (!ctx.hasUI) {
				ctx.ui.notify(
					"/goal import requires --yes in non-interactive mode after reviewing the source docs.",
					"error",
				);
				return;
			}
			const ok = await ctx.ui.confirm(
				current ? "Import docs into current goal?" : "Create goal from import?",
				summary,
			);
			if (!ok) {
				ctx.ui.notify("Goal import cancelled.", "info");
				return;
			}
		}

		const latest = loadGoalState(ctx);
		if (latest && latest.status !== "active") {
			ctx.ui.notify(
				`Cannot import docs into a ${latest.status} goal. Run /goal resume first, or /goal clear --yes before creating a new goal from docs.`,
				"error",
			);
			return;
		}
		if (current?.goalId !== latest?.goalId) {
			ctx.ui.notify("Goal changed before saving. Re-run /goal import for the current goal.", "error");
			return;
		}
		const next = latest
			? saveGoalState(
					pi,
					{
						action: "import-docs",
						goalId: latest.goalId,
						now: Date.now(),
						sourceDocs: imported.sourceDocs,
						constraints: imported.constraints.length > 0 ? imported.constraints : undefined,
						acceptanceCriteria:
							imported.acceptanceCriteria.length > 0 ? imported.acceptanceCriteria : undefined,
						reason: `Imported docs: ${imported.sourceDocs.map((doc) => doc.path).join(", ")}`,
					},
					latest,
				)
			: saveGoalState(
					pi,
					{
						action: "create",
						goalId: crypto.randomUUID(),
						objective: imported.objective,
						now: Date.now(),
						owner: "user",
						sourceDocs: imported.sourceDocs,
						constraints: imported.constraints,
						acceptanceCriteria: imported.acceptanceCriteria,
						reason: `Created from import: ${imported.sourceDocs.map((doc) => doc.path).join(", ")}`,
					},
					null,
				);
		updateGoalUi(ctx, next);
		ctx.ui.notify(latest ? "Goal docs imported." : "Goal created from import.", "success");
		if (next) await offerGoalStartHandoff(pi, ctx, next.goalId, parsed.start);
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
	}
}

async function createOrReplaceGoal(
	pi: ExtensionAPI,
	ctx: GoalCommandContext,
	parsed: ParsedGoalCommand,
	current: GoalState | null,
): Promise<void> {
	const objective = validateObjective(parsed.objective ?? "");
	const prepared = await preparePlainGoalDraft(objective);
	let proposal = prepared.proposal;
	let proposedObjective = validateObjective(proposal.objective);
	let startAfterSave = parsed.start;
	let action: "create" | "replace" = "create";

	if (current) {
		if (!parsed.replace) {
			if (!ctx.hasUI) {
				ctx.ui.notify(
					"A goal already exists. Re-run with --replace to replace it in non-interactive mode.",
					"error",
				);
				return;
			}
			const ok = await ctx.ui.confirm(
				"Replace current goal?",
				`Current: ${current.objective}\n\nNew: ${proposedObjective}`,
			);
			if (!ok) {
				ctx.ui.notify("Goal replacement cancelled.", "info");
				return;
			}
		}
		action = "replace";
	}

	if (prepared.warning) {
		ctx.ui.notify(prepared.warning, "warning");
	}
	if (ctx.hasUI && ctx.ui.select) {
		const review = await reviewGeneratedGoalProposal(ctx, proposal);
		if (!review) return;
		proposal = review.proposal;
		proposedObjective = validateObjective(proposal.objective);
		startAfterSave = review.start;
	} else if (!prepared.warning && ctx.hasUI && !parsed.confirmed) {
		const ok = await ctx.ui.confirm("Use generated goal proposal?", renderGoalProposalReview(proposal));
		if (!ok) {
			ctx.ui.notify("Goal proposal cancelled.", "info");
			return;
		}
	} else if (!prepared.warning || !ctx.hasUI) {
		ctx.ui.notify(renderGoalProposalReview(proposal), "info");
	}

	const latest = loadGoalState(ctx);
	if (current?.goalId !== latest?.goalId) {
		ctx.ui.notify("Goal changed before saving. Re-run /goal with your objective.", "error");
		return;
	}
	const next = saveGoalState(
		pi,
		{
			action: latest ? "replace" : action,
			goalId: crypto.randomUUID(),
			objective: proposedObjective,
			acceptanceCriteria: proposal.acceptanceCriteria,
			now: Date.now(),
			owner: "user",
		},
		latest,
	);
	updateGoalUi(ctx, next);
	ctx.ui.notify(action === "replace" ? "Goal replaced." : "Goal created.", "success");
	if (next) await offerGoalStartHandoff(pi, ctx, next.goalId, startAfterSave);
}

async function offerGoalStartHandoff(
	api: Partial<GoalStartAPI>,
	ctx: GoalCommandContext,
	expectedGoalId: string,
	startImmediately: boolean,
): Promise<void> {
	if (startImmediately) {
		await startActiveGoal(api, ctx, expectedGoalId);
		return;
	}
	if (!ctx.hasUI) return;

	const latest = loadGoalState(ctx);
	if (!latest || latest.goalId !== expectedGoalId) {
		ctx.ui.notify("Goal changed before starting. Re-run /goal start for the current goal.", "error");
		return;
	}
	const ok = await ctx.ui.confirm("Start working on this goal now?", latest.objective);
	if (!ok) return;
	await startActiveGoal(api, ctx, expectedGoalId);
}

export async function startActiveGoal(
	api: Partial<GoalStartAPI>,
	ctx: GoalCommandContext,
	expectedGoalId?: string,
): Promise<boolean> {
	const latest = loadGoalState(ctx);
	if (!latest) {
		ctx.ui.notify(noGoalMessage("start"), "error");
		return false;
	}
	if (expectedGoalId && latest.goalId !== expectedGoalId) {
		ctx.ui.notify("Goal changed before starting. Re-run /goal start for the current goal.", "error");
		return false;
	}
	if (latest.status !== "active") {
		ctx.ui.notify(
			`Cannot start a ${latest.status} goal. Run /goal resume first or choose an active goal.`,
			"error",
		);
		return false;
	}
	if (!api.sendUserMessage) {
		ctx.ui.notify("Cannot start goal: follow-up messaging API is unavailable.", "error");
		return false;
	}

	api.sendUserMessage(renderGoalStartPrompt(latest), { deliverAs: "followUp" });
	ctx.ui.notify("Goal start queued.", "success");
	return true;
}

async function editGoal(pi: ExtensionAPI, ctx: GoalCommandContext, current: GoalState | null): Promise<void> {
	if (!current) {
		ctx.ui.notify(noGoalMessage("edit"), "error");
		return;
	}
	if (!ctx.hasUI) {
		ctx.ui.notify("/goal edit requires interactive UI. Use /goal <objective> --replace instead.", "error");
		return;
	}

	const edited = await ctx.ui.editor(
		"Edit goal",
		renderEditableGoalDraft({
			objective: current.objective,
			acceptanceCriteria: current.acceptanceCriteria,
		}),
	);
	if (edited === undefined) {
		ctx.ui.notify("Goal edit cancelled.", "info");
		return;
	}

	const latest = loadGoalState(ctx);
	if (!latest || latest.goalId !== current.goalId) {
		ctx.ui.notify("Goal changed while editing. Re-run /goal edit.", "error");
		return;
	}

	const draft = parseEditableGoalDraft(edited);
	const next = saveGoalState(
		pi,
		{
			action: "edit",
			goalId: latest.goalId,
			objective: draft.objective,
			acceptanceCriteria: draft.acceptanceCriteria,
			now: Date.now(),
		},
		latest,
	);
	updateGoalUi(ctx, next);
	ctx.ui.notify("Goal updated.", "success");
}

function mutateExistingGoal(
	pi: ExtensionAPI,
	ctx: GoalCommandContext,
	current: GoalState | null,
	action: "pause" | "resume",
	message: string,
): GoalState | null {
	if (!current) {
		ctx.ui.notify(noGoalMessage(action), "error");
		return null;
	}
	const latest = loadGoalState(ctx);
	if (!latest || latest.goalId !== current.goalId) {
		ctx.ui.notify("Goal changed before saving. Re-run the command.", "error");
		return null;
	}
	if (action === "pause" && latest.status !== "active") {
		ctx.ui.notify("Only active goals can be paused.", "error");
		return null;
	}
	if (action === "resume" && latest.status !== "paused") {
		ctx.ui.notify("Only paused goals can be resumed.", "error");
		return null;
	}
	const next = saveGoalState(pi, { action, goalId: latest.goalId, now: Date.now() }, latest);
	updateGoalUi(ctx, next);
	ctx.ui.notify(message, "success");
	return next;
}

async function confirmThenMutate(
	pi: ExtensionAPI,
	ctx: GoalCommandContext,
	current: GoalState | null,
	action: "clear" | "complete",
	confirmed: boolean,
	confirmTitle: string,
	message: string,
): Promise<void> {
	if (!current) {
		ctx.ui.notify(noGoalMessage(action), "error");
		return;
	}

	if (!confirmed) {
		if (!ctx.hasUI) {
			ctx.ui.notify(
				nonInteractiveConfirmationMessage(action === "clear" ? "/goal clear" : "/goal complete"),
				"error",
			);
			return;
		}
		const ok = await ctx.ui.confirm(confirmTitle, current.objective);
		if (!ok) {
			ctx.ui.notify("Goal mutation cancelled.", "info");
			return;
		}
	}

	const latest = loadGoalState(ctx);
	if (!latest || latest.goalId !== current.goalId) {
		ctx.ui.notify("Goal changed before saving. Re-run the command.", "error");
		return;
	}
	if (action === "complete" && latest.status !== "active") {
		ctx.ui.notify("Only active goals can be completed.", "error");
		return;
	}
	const next = saveGoalState(
		pi,
		{ action, goalId: latest.goalId, now: Date.now() } as GoalStateEvent,
		latest,
	);
	updateGoalUi(ctx, next);
	ctx.ui.notify(message, "success");
}

function updateGoalUi(ctx: GoalCommandContext, goal: GoalState | null): void {
	applyGoalUi(ctx, goal);
}

async function reviewGeneratedGoalProposal(
	ctx: GoalCommandContext,
	initialProposal: GoalDraftProposal,
): Promise<{ proposal: GoalDraftProposal; start: boolean } | null> {
	let proposal = initialProposal;

	while (true) {
		const choice = await ctx.ui.select?.("Review generated goal proposal", ["Start", "Edit", "Cancel"]);
		if (choice === "Start") return { proposal, start: true };
		if (choice === "Cancel" || choice === undefined) {
			// Product decision for this lane: cancelling review does not persist the unsaved generated proposal.
			ctx.ui.notify("Goal proposal cancelled; no goal was saved.", "info");
			return null;
		}
		if (choice !== "Edit") continue;

		const edited = await ctx.ui.editor("Edit goal proposal", renderEditableGoalDraft(proposal));
		if (edited === undefined) continue;
		try {
			proposal = parseEditableGoalDraft(edited);
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	}
}

function renderGoalProposalReview(proposal: { objective: string; acceptanceCriteria: string[] }): string {
	return [
		`Objective: ${proposal.objective}`,
		"Acceptance criteria:",
		...(proposal.acceptanceCriteria.length > 0
			? proposal.acceptanceCriteria.map((item) => `- ${item}`)
			: ["- none"]),
	].join("\n");
}
