export type GoalStatus = "active" | "paused" | "complete";

export type GoalOwner = "user" | "model";

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
	owner: GoalOwner;
}

export interface GoalCreateEvent {
	action: "create";
	goalId: string;
	objective: string;
	now: number;
	owner?: GoalOwner;
	sourceDocs?: GoalSourceDoc[];
	constraints?: string[];
	acceptanceCriteria?: string[];
	progress?: Partial<GoalProgress>;
	reason?: string;
}

export interface GoalReplaceEvent extends Omit<GoalCreateEvent, "action"> {
	action: "replace";
}

export interface GoalEditEvent {
	action: "edit";
	goalId: string;
	now: number;
	objective?: string;
	sourceDocs?: GoalSourceDoc[];
	constraints?: string[];
	acceptanceCriteria?: string[];
	reason?: string;
}

export interface GoalPauseEvent {
	action: "pause";
	goalId: string;
	now: number;
	reason?: string;
}

export interface GoalResumeEvent {
	action: "resume";
	goalId: string;
	now: number;
	reason?: string;
}

export interface GoalClearEvent {
	action: "clear";
	goalId: string;
	now: number;
	reason?: string;
}

export interface GoalCompleteEvent {
	action: "complete";
	goalId: string;
	now: number;
	reason?: string;
}

export interface GoalProgressEvent {
	action: "progress";
	goalId: string;
	now: number;
	progress: Partial<GoalProgress>;
	reason?: string;
}

export interface GoalImportDocsEvent {
	action: "import-docs";
	goalId: string;
	now: number;
	sourceDocs: GoalSourceDoc[];
	constraints?: string[];
	acceptanceCriteria?: string[];
	reason?: string;
}

export type GoalStateEvent =
	| GoalCreateEvent
	| GoalReplaceEvent
	| GoalEditEvent
	| GoalPauseEvent
	| GoalResumeEvent
	| GoalClearEvent
	| GoalCompleteEvent
	| GoalProgressEvent
	| GoalImportDocsEvent;

export type GoalStateAction = GoalStateEvent["action"] | "set";

export interface GoalStateEntry {
	action: GoalStateAction;
	state: GoalState | null;
	event?: GoalStateEvent;
	reason?: string;
}

export interface GoalStateSnapshot {
	current: GoalState | null;
	entries: GoalStateEntry[];
}
