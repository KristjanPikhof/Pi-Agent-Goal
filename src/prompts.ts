import type { GoalSourceDoc, GoalState } from "./types.js";

export const GOAL_CONTEXT_CUSTOM_TYPE = "goal-context";

export interface GoalCompactionDetails {
	goal: {
		goalId: string;
		objective: string;
		status: GoalState["status"];
		acceptanceCriteria: string[];
		sourceDocs: Array<Pick<GoalSourceDoc, "path" | "kind" | "brief">>;
		progress: GoalState["progress"];
	};
}

export function renderGoalContext(goal: GoalState): string {
	return [
		`<goal_context goal_id="${escapeXml(goal.goalId)}">`,
		`Objective: ${escapeXml(goal.objective)}`,
		`Status: ${escapeXml(goal.status)}`,
		"Acceptance criteria:",
		...formatXmlList(goal.acceptanceCriteria),
		`Current progress: ${escapeXml(goal.progress.lastSummary || "No progress recorded yet.")}`,
		goal.progress.current ? `Current work: ${escapeXml(goal.progress.current)}` : undefined,
		goal.progress.blocked.length > 0 ? `Blocked: ${escapeXml(goal.progress.blocked.join("; "))}` : undefined,
		"Source docs:",
		...formatSourceDocs(goal.sourceDocs),
		"Rules:",
		"- Work toward the goal unless the user asks for something else.",
		"- If the goal is complete, call complete_goal with evidence.",
		"- Do not change objective, source docs, or acceptance criteria without explicit user confirmation.",
		"</goal_context>",
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

export function renderCompactGoalSummary(goal: GoalState): string {
	return [
		"## Active goal",
		`Goal ID: ${goal.goalId}`,
		`Objective: ${goal.objective}`,
		`Status: ${goal.status}`,
		"Acceptance criteria:",
		...formatMarkdownList(goal.acceptanceCriteria),
		"Source docs:",
		...formatMarkdownList(goal.sourceDocs.map((doc) => `${doc.path}: ${doc.brief}`)),
		"Progress:",
		`- Summary: ${goal.progress.lastSummary || "No progress recorded yet."}`,
		goal.progress.current ? `- Current: ${goal.progress.current}` : undefined,
		...goal.progress.done.map((item) => `- Done: ${item}`),
		...goal.progress.blocked.map((item) => `- Blocked: ${item}`),
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

export function compactGoalDetails(goal: GoalState): GoalCompactionDetails {
	return {
		goal: {
			goalId: goal.goalId,
			objective: goal.objective,
			status: goal.status,
			acceptanceCriteria: [...goal.acceptanceCriteria],
			sourceDocs: goal.sourceDocs.map((doc) => ({ path: doc.path, kind: doc.kind, brief: doc.brief })),
			progress: {
				done: [...goal.progress.done],
				current: goal.progress.current,
				blocked: [...goal.progress.blocked],
				lastSummary: goal.progress.lastSummary,
			},
		},
	};
}

export function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function formatXmlList(items: string[]): string[] {
	return items.length === 0 ? ["- none"] : items.map((item) => `- ${escapeXml(item)}`);
}

function formatSourceDocs(sourceDocs: GoalSourceDoc[]): string[] {
	if (sourceDocs.length === 0) return ["- none"];
	return sourceDocs.map((doc) => `- ${escapeXml(doc.path)} (${escapeXml(doc.kind)}): ${escapeXml(doc.brief)}`);
}

function formatMarkdownList(items: string[]): string[] {
	return items.length === 0 ? ["- none"] : items.map((item) => `- ${item}`);
}
