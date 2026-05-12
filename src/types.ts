export type GoalStatus = "active" | "paused" | "complete";

export interface GoalSourceDoc {
	path: string;
	kind: "prd" | "doc" | "directory" | "manual";
	brief: string;
	hash?: string;
	extractedAt: number;
}

export interface GoalProgress {
	done: string[];
	current?: string;
	blocked: string[];
	lastSummary: string;
}

export interface GoalState {
	version: 1;
	goalId: string;
	objective: string;
	status: GoalStatus;
	sourceDocs: GoalSourceDoc[];
	constraints: string[];
	acceptanceCriteria: string[];
	progress: GoalProgress;
	createdAt: number;
	updatedAt: number;
	completedAt?: number;
	owner: "user" | "model";
}

export type GoalStateAction = "set" | "clear" | "pause" | "resume" | "complete" | "progress" | "import-docs";

export interface GoalStateEntry {
	action: GoalStateAction;
	state: GoalState | null;
	reason?: string;
}
