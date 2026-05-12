import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { importGoalSources } from "./import.js";
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
	| "clear"
	| "complete"
	| "import";

export interface ParsedGoalCommand {
	kind: GoalCommandKind;
	objective?: string;
	path?: string;
	confirmed: boolean;
	replace: boolean;
}

interface GoalCommandContext {
	cwd: string;
	hasUI: boolean;
	sessionManager: { getBranch(): Array<{ type: string; customType?: string; data?: unknown }> };
	waitForIdle(): Promise<void>;
	ui: {
		notify(message: string, level?: "info" | "success" | "warning" | "error"): void;
		confirm(title: string, message: string): Promise<boolean>;
		editor(title: string, initialValue: string): Promise<string | undefined>;
		setStatus(key: string, value: string | undefined): void;
		setWidget(key: string, value: string[] | undefined): void;
	};
}

const CONTROL_COMMANDS = new Set(["status", "edit", "pause", "resume", "clear", "complete", "import"]);
const RECOGNIZED_FLAGS = new Set(["--yes", "-y", "--replace"]);

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
			case "edit":
				await editGoal(pi, ctx, current);
				return;
			case "pause":
				mutateExistingGoal(pi, ctx, current, "pause", "Goal paused.");
				return;
			case "resume":
				mutateExistingGoal(pi, ctx, current, "resume", "Goal resumed.");
				return;
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
	if (!trimmed) return { kind: "show", confirmed: false, replace: false };

	const tokens = trimmed.split(/\s+/);
	const [first = ""] = tokens;
	const flags = new Set(tokens.filter((token) => token.startsWith("-")));
	const confirmed = flags.has("--yes") || flags.has("-y");
	const replace = flags.has("--replace");

	if (first === "status") return { kind: "status", confirmed, replace };
	if (first === "edit") return { kind: "edit", confirmed, replace };
	if (first === "pause") return { kind: "pause", confirmed, replace };
	if (first === "resume") return { kind: "resume", confirmed, replace };
	if (first === "clear") return { kind: "clear", confirmed, replace };
	if (first === "complete") return { kind: "complete", confirmed, replace };
	if (first === "import") {
		const pathArg = tokens
			.slice(1)
			.filter((token) => !token.startsWith("-"))
			.join(" ")
			.trim();
		return { kind: "import", path: pathArg, confirmed, replace };
	}

	const objective = tokens
		.filter((token) => !RECOGNIZED_FLAGS.has(token))
		.join(" ")
		.trim();
	return { kind: "create", objective, confirmed, replace };
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
				`Current: ${current.objective}\n\nNew: ${objective}`,
			);
			if (!ok) {
				ctx.ui.notify("Goal replacement cancelled.", "info");
				return;
			}
		}
		action = "replace";
	}

	const latest = loadGoalState(ctx);
	if (current?.goalId !== latest?.goalId && !parsed.replace) {
		ctx.ui.notify("Goal changed before saving. Re-run /goal with your objective.", "error");
		return;
	}
	const next = saveGoalState(
		pi,
		{
			action: latest ? "replace" : action,
			goalId: crypto.randomUUID(),
			objective,
			now: Date.now(),
			owner: "user",
		},
		latest,
	);
	updateGoalUi(ctx, next);
	ctx.ui.notify(action === "replace" ? "Goal replaced." : "Goal created.", "success");
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

	const edited = await ctx.ui.editor("Edit goal objective", current.objective);
	if (edited === undefined) {
		ctx.ui.notify("Goal edit cancelled.", "info");
		return;
	}

	const latest = loadGoalState(ctx);
	if (!latest || latest.goalId !== current.goalId) {
		ctx.ui.notify("Goal changed while editing. Re-run /goal edit.", "error");
		return;
	}

	const next = saveGoalState(
		pi,
		{ action: "edit", goalId: latest.goalId, objective: edited, now: Date.now() },
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
): void {
	if (!current) {
		ctx.ui.notify(noGoalMessage(action), "error");
		return;
	}
	const latest = loadGoalState(ctx);
	if (!latest || latest.goalId !== current.goalId) {
		ctx.ui.notify("Goal changed before saving. Re-run the command.", "error");
		return;
	}
	if (action === "pause" && latest.status !== "active") {
		ctx.ui.notify("Only active goals can be paused.", "error");
		return;
	}
	if (action === "resume" && latest.status !== "paused") {
		ctx.ui.notify("Only paused goals can be resumed.", "error");
		return;
	}
	const next = saveGoalState(pi, { action, goalId: latest.goalId, now: Date.now() }, latest);
	updateGoalUi(ctx, next);
	ctx.ui.notify(message, "success");
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
