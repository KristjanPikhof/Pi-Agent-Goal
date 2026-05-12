import type {
	GoalProgress,
	GoalSourceDoc,
	GoalState,
	GoalStateEntry,
	GoalStateEvent,
	GoalStateSnapshot,
} from "./types.js";

export const GOAL_CUSTOM_TYPE = "goal-state";
export const MAX_OBJECTIVE_LENGTH = 4000;

interface GoalSessionEntry {
	type: string;
	customType?: string;
	data?: unknown;
}

interface GoalSessionContext {
	sessionManager: {
		getBranch(): GoalSessionEntry[];
	};
}

interface GoalAppendAPI {
	appendEntry(customType: string, data?: unknown): unknown;
}

export class GoalStateValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GoalStateValidationError";
	}
}

export function validateObjective(objective: string): string {
	const trimmed = objective.trim();
	if (trimmed.length === 0) {
		throw new GoalStateValidationError("Goal objective must be non-empty.");
	}
	if (trimmed.length > MAX_OBJECTIVE_LENGTH) {
		throw new GoalStateValidationError(`Goal objective must be ${MAX_OBJECTIVE_LENGTH} characters or fewer.`);
	}
	return trimmed;
}

export function createGoalState(event: Extract<GoalStateEvent, { action: "create" | "replace" }>): GoalState {
	const objective = validateObjective(event.objective);
	return {
		version: 1,
		goalId: event.goalId,
		objective,
		status: "active",
		sourceDocs: [...(event.sourceDocs ?? [])],
		constraints: [...(event.constraints ?? [])],
		acceptanceCriteria: [...(event.acceptanceCriteria ?? [])],
		progress: normalizeProgress(event.progress),
		createdAt: event.now,
		updatedAt: event.now,
		owner: event.owner ?? "user",
	};
}

export function reduceGoalState(current: GoalState | null, event: GoalStateEvent): GoalState | null {
	switch (event.action) {
		case "create":
			return current ?? createGoalState(event);
		case "replace":
			return createGoalState(event);
		case "edit": {
			if (!isCurrentGoal(current, event.goalId)) return current;
			return {
				...current,
				objective: event.objective === undefined ? current.objective : validateObjective(event.objective),
				sourceDocs: event.sourceDocs === undefined ? current.sourceDocs : [...event.sourceDocs],
				constraints: event.constraints === undefined ? current.constraints : [...event.constraints],
				acceptanceCriteria:
					event.acceptanceCriteria === undefined ? current.acceptanceCriteria : [...event.acceptanceCriteria],
				updatedAt: event.now,
			};
		}
		case "pause": {
			if (!isCurrentGoal(current, event.goalId)) return current;
			return { ...current, status: "paused", updatedAt: event.now, completedAt: undefined };
		}
		case "resume": {
			if (!isCurrentGoal(current, event.goalId)) return current;
			return { ...current, status: "active", updatedAt: event.now, completedAt: undefined };
		}
		case "clear":
			return isCurrentGoal(current, event.goalId) ? null : current;
		case "complete": {
			if (!isCurrentGoal(current, event.goalId)) return current;
			return { ...current, status: "complete", updatedAt: event.now, completedAt: event.now };
		}
		case "progress": {
			if (!isCurrentGoal(current, event.goalId)) return current;
			return {
				...current,
				progress: normalizeProgress(event.progress, current.progress),
				updatedAt: event.now,
			};
		}
		case "import-docs": {
			if (!isCurrentGoal(current, event.goalId)) return current;
			return {
				...current,
				sourceDocs: mergeSourceDocs(current.sourceDocs, event.sourceDocs),
				constraints: event.constraints === undefined ? current.constraints : [...event.constraints],
				acceptanceCriteria:
					event.acceptanceCriteria === undefined ? current.acceptanceCriteria : [...event.acceptanceCriteria],
				updatedAt: event.now,
			};
		}
	}
}

export function toGoalStateEntry(event: GoalStateEvent, current: GoalState | null): GoalStateEntry {
	const next = reduceGoalState(current, event);
	return {
		action: event.action,
		state: cloneGoalState(next),
		event: cloneEvent(event),
		reason: event.reason,
	};
}

export function saveGoalState(
	pi: GoalAppendAPI,
	event: GoalStateEvent,
	current: GoalState | null,
): GoalState | null {
	const entry = toGoalStateEntry(event, current);
	pi.appendEntry(GOAL_CUSTOM_TYPE, entry);
	return cloneGoalState(entry.state);
}

export function loadGoalState(ctx: GoalSessionContext): GoalState | null {
	return createGoalStateSnapshot(ctx.sessionManager.getBranch()).current;
}

export function createGoalStateSnapshot(branchEntries: GoalSessionEntry[]): GoalStateSnapshot {
	let current: GoalState | null = null;
	const entries: GoalStateEntry[] = [];

	for (const branchEntry of branchEntries) {
		if (branchEntry.type !== "custom" || branchEntry.customType !== GOAL_CUSTOM_TYPE) continue;

		const goalEntry = parseGoalStateEntry(branchEntry.data);
		if (!goalEntry) continue;

		if (goalEntry.event) {
			current = reduceGoalState(current, goalEntry.event);
		} else {
			current = reducePersistedState(current, goalEntry);
		}
		entries.push({ ...goalEntry, state: cloneGoalState(current) });
	}

	return { current: cloneGoalState(current), entries };
}

export function getCurrentGoal(snapshot: GoalStateSnapshot): GoalState | null {
	return cloneGoalState(snapshot.current);
}

function isCurrentGoal(current: GoalState | null, goalId: string): current is GoalState {
	return current !== null && current.goalId === goalId;
}

function normalizeProgress(progress: Partial<GoalProgress> = {}, base?: GoalProgress): GoalProgress {
	return {
		done: [...(progress.done ?? base?.done ?? [])],
		current: progress.current ?? base?.current,
		blocked: [...(progress.blocked ?? base?.blocked ?? [])],
		lastSummary: progress.lastSummary ?? base?.lastSummary ?? "",
	};
}

function mergeSourceDocs(existing: GoalSourceDoc[], incoming: GoalSourceDoc[]): GoalSourceDoc[] {
	const byPath = new Map(existing.map((doc) => [doc.path, doc]));
	for (const doc of incoming) {
		byPath.set(doc.path, doc);
	}
	return [...byPath.values()];
}

function parseGoalStateEntry(data: unknown): GoalStateEntry | null {
	if (!isRecord(data) || typeof data.action !== "string" || !("state" in data)) return null;
	const event = isRecord(data.event) ? (data.event as unknown as GoalStateEvent) : undefined;
	return {
		action: data.action as GoalStateEntry["action"],
		state: isGoalState(data.state) ? cloneGoalState(data.state) : null,
		event,
		reason: typeof data.reason === "string" ? data.reason : undefined,
	};
}

function reducePersistedState(current: GoalState | null, entry: GoalStateEntry): GoalState | null {
	if (entry.action === "clear") return entry.state === null ? null : current;
	if (entry.state === null) return current;
	if (entry.action === "create" || entry.action === "replace" || entry.action === "set")
		return cloneGoalState(entry.state);
	if (!isCurrentGoal(current, entry.state.goalId)) return current;
	return cloneGoalState(entry.state);
}

function isGoalState(value: unknown): value is GoalState {
	return isRecord(value) && value.version === 1 && typeof value.goalId === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function cloneGoalState(state: GoalState | null): GoalState | null {
	return state === null
		? null
		: {
				...state,
				sourceDocs: state.sourceDocs.map((doc) => ({ ...doc })),
				constraints: [...state.constraints],
				acceptanceCriteria: [...state.acceptanceCriteria],
				progress: normalizeProgress(state.progress),
			};
}

function cloneEvent(event: GoalStateEvent): GoalStateEvent {
	return structuredClone(event) as GoalStateEvent;
}
