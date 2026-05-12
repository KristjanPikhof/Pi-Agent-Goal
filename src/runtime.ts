import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createGoalStateSnapshot, loadGoalState } from "./state.js";
import {
	compactGoalDetails,
	GOAL_CONTEXT_CUSTOM_TYPE,
	renderCompactGoalSummary,
	renderGoalContext,
} from "./prompts.js";

import type { GoalState } from "./types.js";

interface GoalRuntimeContext {
	sessionManager: { getBranch(): Array<{ type: string; customType?: string; data?: unknown }> };
}

interface ContextMessage {
	role?: string;
	customType?: string;
	content?: unknown;
	details?: unknown;
}

export function registerGoalRuntime(pi: ExtensionAPI): void {
	pi.on("before_agent_start", async (_event, ctx) => {
		const goal = loadGoalState(ctx as GoalRuntimeContext);
		if (!isActiveGoal(goal)) return;
		return {
			message: {
				customType: GOAL_CONTEXT_CUSTOM_TYPE,
				content: renderGoalContext(goal),
				display: false,
				details: { goalId: goal.goalId },
			},
		};
	});

	pi.on("context", async (event, ctx) => {
		const goal = loadGoalState(ctx as GoalRuntimeContext);
		return { messages: filterGoalContextMessages(event.messages as ContextMessage[], goal) };
	});

	pi.on("session_before_compact", async (event) => createGoalCompaction(event));
}

export function createGoalContextMessage(goal: GoalState): {
	customType: string;
	content: string;
	display: false;
	details: { goalId: string };
} | undefined {
	if (!isActiveGoal(goal)) return undefined;
	return {
		customType: GOAL_CONTEXT_CUSTOM_TYPE,
		content: renderGoalContext(goal),
		display: false,
		details: { goalId: goal.goalId },
	};
}

export function filterGoalContextMessages<T extends ContextMessage>(messages: T[], goal: GoalState | null): T[] {
	const activeGoalId = isActiveGoal(goal) ? goal.goalId : undefined;
	let lastCurrentContextIndex = -1;

	if (activeGoalId) {
		messages.forEach((message, index) => {
			if (isGoalContextMessage(message) && messageHasGoalId(message, activeGoalId)) {
				lastCurrentContextIndex = index;
			}
		});
	}

	return messages.filter((message, index) => {
		if (!isGoalContextMessage(message)) return true;
		if (!activeGoalId) return false;
		return index === lastCurrentContextIndex && messageHasGoalId(message, activeGoalId);
	});
}

export function createGoalCompaction(event: {
	preparation: { previousSummary?: string; firstKeptEntryId: string; tokensBefore: number };
	branchEntries: Array<{ type: string; customType?: string; data?: unknown }>;
}):
	| {
			compaction: {
				summary: string;
				firstKeptEntryId: string;
				tokensBefore: number;
				details: ReturnType<typeof compactGoalDetails>;
			};
	  }
	| undefined {
	const goal = createGoalStateSnapshot(event.branchEntries).current;
	if (!isActiveGoal(goal)) return undefined;

	const priorSummary = event.preparation.previousSummary?.trim();
	const summary = [
		priorSummary || "Conversation summary will continue from Pi's retained recent messages.",
		renderCompactGoalSummary(goal),
	].join("\n\n");

	return {
		compaction: {
			summary,
			firstKeptEntryId: event.preparation.firstKeptEntryId,
			tokensBefore: event.preparation.tokensBefore,
			details: compactGoalDetails(goal),
		},
	};
}

function isActiveGoal(goal: GoalState | null): goal is GoalState {
	return goal !== null && goal.status === "active";
}

function isGoalContextMessage(message: ContextMessage): boolean {
	return message.customType === GOAL_CONTEXT_CUSTOM_TYPE;
}

function messageHasGoalId(message: ContextMessage, goalId: string): boolean {
	const details = message.details;
	if (typeof details === "object" && details !== null && "goalId" in details && details.goalId === goalId) {
		return true;
	}
	const content = typeof message.content === "string" ? message.content : "";
	return content.includes(`goal_id="${goalId.replace(/"/g, "&quot;")}"`);
}
