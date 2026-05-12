import type { GoalState } from "./types.js";

export const GOAL_USAGE = [
	"Usage:",
	"  /goal <objective>          Start a long-running goal; interactive UI can edit before start",
	"  /goal status               Show expanded goal status",
	"  /goal import <path> [--yes] Import a PRD/docs file or folder",
	"  /goal edit                 Edit the objective (interactive UI only)",
	"  /goal pause|resume         Pause or resume the active goal",
	"  /goal clear [--yes]        Clear the current goal",
	"  /goal complete [--yes]     Mark the current goal complete",
	"",
	"Interactive mode: review, edit, or cancel the criteria-free draft before starting."
	"Non-interactive mode: use --yes for destructive/import confirmations and --replace to replace goals.",
].join("\n");

export interface GoalUiContext {
	hasUI?: boolean;
	ui?: {
		setStatus?: (key: string, value: string | undefined) => void;
		setWidget?: (key: string, value: string[] | undefined) => void;
	};
}

export function renderGoalSummary(goal: GoalState): string {
	const lines = [
		`Goal: ${goal.objective}`,
		`Status: ${goal.status}`,
		`Progress: ${goal.progress.lastSummary || "No progress recorded yet."}`,
	];

	if (goal.progress.current) lines.push(`Current: ${goal.progress.current}`);
	if (goal.progress.blocked.length > 0) lines.push(`Blocked: ${goal.progress.blocked.length} item(s)`);
	if (goal.acceptanceCriteria.length > 0) lines.push(`Acceptance: ${goal.acceptanceCriteria.length} item(s)`);
	if (goal.sourceDocs.length > 0)
		lines.push(`Source docs: ${goal.sourceDocs.map((doc) => doc.path).join(", ")}`);
	lines.push(`Next actions: ${nextActionsForStatus(goal)}`);

	return lines.join("\n");
}

export function renderGoalStatus(goal: GoalState): string {
	return [
		renderGoalSummary(goal),
		"",
		"Acceptance criteria:",
		...formatAcceptanceCriteriaList(goal.acceptanceCriteria),
		"",
		"Constraints:",
		...formatList(goal.constraints),
		"",
		"Progress done:",
		...formatList(goal.progress.done),
		"",
		"Current work:",
		`- ${goal.progress.current || "none"}`,
		"",
		"Blocked:",
		...formatList(goal.progress.blocked),
		"",
		"Source docs:",
		...formatList(goal.sourceDocs.map((doc) => `${doc.path} (${doc.kind}): ${doc.brief}`)),
		"",
		"Commands:",
		`- ${nextActionsForStatus(goal)}`,
	].join("\n");
}

export function renderGoalWidget(goal: GoalState): string[] | undefined {
	if (goal.status !== "active") return undefined;
	const lines = [`goal: active`, `→ ${truncate(goal.objective, 80)}`];
	if (goal.progress.current) lines.push(`now: ${truncate(goal.progress.current, 80)}`);
	else if (goal.progress.lastSummary) lines.push(`progress: ${truncate(goal.progress.lastSummary, 80)}`);
	if (goal.acceptanceCriteria.length > 0) lines.push(`criteria: ${goal.acceptanceCriteria.length}`);
	if (goal.sourceDocs.length > 0) lines.push(`sources: ${formatSourceHint(goal)}`);
	if (goal.progress.blocked.length > 0) lines.push(`blocked: ${goal.progress.blocked.length}`);
	return lines;
}

export function formatGoalStatusLabel(goal: GoalState | null): string | undefined {
	return goal ? `goal: ${goal.status}` : undefined;
}

export function applyGoalUi(ctx: GoalUiContext, goal: GoalState | null): void {
	ctx.ui?.setStatus?.("goal", formatGoalStatusLabel(goal));
	ctx.ui?.setWidget?.("goal", goal ? renderGoalWidget(goal) : undefined);
}

export function noGoalMessage(action: string): string {
	return `No goal exists to ${action}. Start one with /goal <objective> or import docs with /goal import <path>.`;
}

export function nonInteractiveConfirmationMessage(command: string): string {
	return `${command} requires --yes in non-interactive mode. Re-run with --yes after reviewing the action.`;
}

function nextActionsForStatus(goal: GoalState): string {
	if (goal.status === "active") return "/goal status, /goal pause, /goal complete, /goal clear";
	if (goal.status === "paused") return "/goal resume, /goal status, /goal clear";
	return "/goal status, /goal clear, or /goal <objective> --replace";
}

function formatSourceHint(goal: GoalState): string {
	const paths = goal.sourceDocs.map((doc) => doc.path);
	const visible = paths.slice(0, 2).join(", ");
	const remaining = paths.length - 2;
	return remaining > 0 ? `${visible} +${remaining}` : visible;
}

function formatList(items: string[]): string[] {
	return items.length === 0 ? ["- none"] : items.map((item) => `- ${item}`);
}

function formatAcceptanceCriteriaList(items: string[]): string[] {
	return items.length === 0
		? ["- No acceptance criteria were specified for this goal; use the objective as the source of truth."]
		: formatList(items);
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
