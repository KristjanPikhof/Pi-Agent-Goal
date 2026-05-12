import type { GoalState } from "./types.js";

export const GOAL_USAGE = [
	"Usage:",
	"  /goal <objective>       Start a long-running goal",
	"  /goal status            Show expanded goal status",
	"  /goal edit              Edit the objective (interactive UI only)",
	"  /goal pause|resume      Pause or resume the active goal",
	"  /goal clear [--yes]     Clear the current goal",
	"  /goal complete [--yes]  Mark the current goal complete",
].join("\n");

export function renderGoalSummary(goal: GoalState): string {
	const lines = [
		`Goal: ${goal.objective}`,
		`Status: ${goal.status}`,
		`Progress: ${goal.progress.lastSummary || "No progress recorded yet."}`,
	];

	if (goal.progress.current) lines.push(`Current: ${goal.progress.current}`);
	if (goal.acceptanceCriteria.length > 0) lines.push(`Acceptance: ${goal.acceptanceCriteria.length} item(s)`);
	if (goal.sourceDocs.length > 0) lines.push(`Source docs: ${goal.sourceDocs.map((doc) => doc.path).join(", ")}`);
	lines.push("Next actions: /goal status, /goal edit, /goal pause, /goal complete, /goal clear");

	return lines.join("\n");
}

export function renderGoalStatus(goal: GoalState): string {
	return [
		renderGoalSummary(goal),
		"",
		"Acceptance criteria:",
		...formatList(goal.acceptanceCriteria),
		"",
		"Constraints:",
		...formatList(goal.constraints),
		"",
		"Done:",
		...formatList(goal.progress.done),
		"",
		"Blocked:",
		...formatList(goal.progress.blocked),
		"",
		"Source docs:",
		...formatList(goal.sourceDocs.map((doc) => `${doc.path} (${doc.kind}): ${doc.brief}`)),
	].join("\n");
}

export function renderGoalWidget(goal: GoalState): string[] | undefined {
	if (goal.status !== "active") return undefined;
	const lines = [`goal: ${goal.status}`, `→ ${goal.objective}`];
	if (goal.progress.current) lines.push(`now: ${goal.progress.current}`);
	if (goal.progress.blocked.length > 0) lines.push(`blocked: ${goal.progress.blocked.length}`);
	return lines;
}

export function formatGoalStatusLabel(goal: GoalState | null): string | undefined {
	return goal ? `goal: ${goal.status}` : undefined;
}

function formatList(items: string[]): string[] {
	return items.length === 0 ? ["- none"] : items.map((item) => `- ${item}`);
}
