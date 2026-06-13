import { truncateToWidth } from "@earendil-works/pi-tui";
import type { GoalState, GoalStatus } from "./types.js";

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
	"Interactive mode: review, edit, or cancel the drafted objective and acceptance criteria before starting.",
	"Non-interactive mode: use --yes for destructive/import confirmations and --replace to replace goals.",
].join("\n");

export interface GoalUiContext {
	mode?: "tui" | "rpc" | "json" | "print";
	hasUI?: boolean;
	ui?: {
		setStatus?: (key: string, value: string | undefined) => void;
		setWidget?: unknown;
	};
}

export type GoalWidgetContent = string[] | GoalWidgetFactory;
export type GoalWidgetFactory = (tui: unknown, theme: GoalWidgetTheme) => GoalWidgetComponent;

export interface GoalWidgetComponent {
	render(width: number): string[];
	invalidate(): void;
}

export interface GoalWidgetTheme {
	fg?: (token: GoalThemeToken, text: string) => string;
	bold?: (text: string) => string;
}

export type GoalThemeToken =
	| "success"
	| "warning"
	| "accent"
	| "muted"
	| "dim"
	| "customMessageText"
	| "customMessageLabel";

export interface GoalSymbols {
	separator: string;
	ellipsis: string;
	completion: string;
}

export interface GoalSymbolOptions {
	ascii?: boolean;
	highContrast?: boolean;
}

export const GOAL_SYMBOLS: { unicode: GoalSymbols; ascii: GoalSymbols } = {
	unicode: { separator: "·", ellipsis: "…", completion: "✓" },
	ascii: { separator: "-", ellipsis: "...", completion: "[x]" },
};

export interface GoalWidgetPresentation {
	status: GoalStatus;
	label: string;
	objective: string;
	acceptanceCount: number;
	blockedCount: number;
	current?: string;
	completedCount: number;
}

interface GoalWidgetRenderOptions {
	symbols?: GoalSymbols;
	theme?: GoalWidgetTheme;
	width?: number;
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

export function renderGoalStatus(goal: GoalState, symbols = getGoalSymbols()): string {
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
		...formatCompletedList(goal.progress.done, symbols),
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

export function createGoalWidgetPresentation(goal: GoalState): GoalWidgetPresentation | undefined {
	if (goal.status !== "active") return undefined;
	return {
		status: goal.status,
		label: "Goal",
		objective: goal.objective,
		acceptanceCount: goal.acceptanceCriteria.length,
		blockedCount: goal.progress.blocked.length,
		current: goal.progress.current || undefined,
		completedCount: goal.progress.done.length,
	};
}

export function renderGoalWidget(goal: GoalState, symbols = getGoalSymbols()): string[] | undefined {
	const presentation = createGoalWidgetPresentation(goal);
	return presentation ? renderGoalWidgetPresentation(presentation, { symbols }) : undefined;
}

export function renderGoalWidgetPresentation(
	presentation: GoalWidgetPresentation,
	options: GoalWidgetRenderOptions = {},
): string[] {
	const symbols = options.symbols ?? getGoalSymbols();
	const separator = ` ${symbols.separator} `;
	const status = styleWidgetPart(presentation.status, statusLabel(presentation.status), options.theme);
	const metadata = [
		styleWidgetPart("label", presentation.label, options.theme),
		status,
		styleWidgetPart("acceptance", `AC: ${presentation.acceptanceCount}`, options.theme),
	];
	if (presentation.blockedCount > 0) {
		metadata.push(styleWidgetPart("blocked", `Blocked: ${presentation.blockedCount}`, options.theme));
	}
	if (presentation.completedCount > 0) {
		metadata.push(
			styleWidgetPart("completed", `${symbols.completion} ${presentation.completedCount}`, options.theme),
		);
	}

	const objective = truncatePlain(presentation.objective, 80, symbols.ellipsis);
	const lines = [
		`${metadata.join(separator)}${separator}${styleWidgetPart("objective", objective, options.theme)}`,
	];
	if (presentation.current) {
		const current = truncatePlain(presentation.current, 80, symbols.ellipsis);
		lines.push(
			`${styleWidgetPart("current", "Now", options.theme)}${separator}${styleWidgetPart("current", current, options.theme)}`,
		);
	}
	return options.width === undefined
		? lines
		: lines.map((line) => truncateToWidth(line, options.width ?? 0, symbols.ellipsis));
}

export function createGoalWidgetFactory(presentation: GoalWidgetPresentation): GoalWidgetFactory {
	return (_tui, theme) => ({
		render(width: number) {
			return renderGoalWidgetPresentation(presentation, { theme, width });
		},
		invalidate() {
			// Stateless render: theme colors are computed fresh in render(), so invalidation only satisfies Pi's component contract.
		},
	});
}

export function getGoalSymbols(options: GoalSymbolOptions = {}): GoalSymbols {
	return options.ascii || options.highContrast ? GOAL_SYMBOLS.ascii : GOAL_SYMBOLS.unicode;
}

export function renderContinuationStatus(kind: "queued" | "running"): string {
	return kind === "queued" ? "goal: continuation queued" : "goal: continuation running";
}

export function applyGoalUi(ctx: GoalUiContext, goal: GoalState | null): void {
	ctx.ui?.setStatus?.("goal", undefined);
	const presentation = goal ? createGoalWidgetPresentation(goal) : undefined;
	if (!presentation) {
		setGoalWidget(ctx, undefined);
		return;
	}
	const content =
		ctx.mode === "tui" ? createGoalWidgetFactory(presentation) : renderGoalWidgetPresentation(presentation);
	setGoalWidget(ctx, content);
}

export function noGoalMessage(action: string): string {
	return `No goal exists to ${action}. Start one with /goal <objective> or import docs with /goal import <path>.`;
}

export function nonInteractiveConfirmationMessage(command: string): string {
	return `${command} requires --yes in non-interactive mode. Re-run with --yes after reviewing the action.`;
}

function setGoalWidget(ctx: GoalUiContext, content: GoalWidgetContent | undefined): void {
	if (typeof ctx.ui?.setWidget !== "function") return;
	(ctx.ui.setWidget as (key: string, value: GoalWidgetContent | undefined) => void)("goal", content);
}

function styleWidgetPart(
	part:
		| "label"
		| "active"
		| "paused"
		| "complete"
		| "acceptance"
		| "blocked"
		| "completed"
		| "current"
		| "objective",
	text: string,
	theme?: GoalWidgetTheme,
): string {
	switch (part) {
		case "active":
			return theme?.fg?.("success", text) ?? text;
		case "paused":
			return theme?.fg?.("dim", text) ?? text;
		case "complete":
		case "completed":
			return theme?.fg?.("success", text) ?? text;
		case "acceptance":
			return theme?.fg?.("muted", text) ?? text;
		case "blocked":
			return theme?.fg?.("warning", text) ?? text;
		case "current":
			return theme?.fg?.("accent", text) ?? text;
		case "label": {
			const label = theme?.bold?.(text) ?? text;
			return theme?.fg?.("customMessageLabel", label) ?? label;
		}
		case "objective":
			return theme?.fg?.("customMessageText", text) ?? text;
	}
}

function statusLabel(status: GoalStatus): string {
	if (status === "active") return "Active";
	if (status === "paused") return "Paused";
	return "Complete";
}

function nextActionsForStatus(goal: GoalState): string {
	if (goal.status === "active") return "/goal status, /goal pause, /goal complete, /goal clear";
	if (goal.status === "paused") return "/goal resume, /goal status, /goal clear";
	return "/goal status, /goal clear, or /goal <objective> --replace";
}

function formatList(items: string[]): string[] {
	return items.length === 0 ? ["- none"] : items.map((item) => `- ${item}`);
}

function formatCompletedList(items: string[], symbols: GoalSymbols): string[] {
	return items.length === 0 ? ["- none"] : items.map((item) => `${symbols.completion} ${item}`);
}

function formatAcceptanceCriteriaList(items: string[]): string[] {
	return items.length === 0
		? ["- No acceptance criteria were specified for this goal; use the objective as the source of truth."]
		: formatList(items);
}

function truncatePlain(value: string, maxLength: number, ellipsis: string): string {
	return value.length <= maxLength
		? value
		: `${value.slice(0, Math.max(0, maxLength - ellipsis.length))}${ellipsis}`;
}
