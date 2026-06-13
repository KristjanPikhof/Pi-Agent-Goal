import type { ExtensionAPI, InputEvent } from "@earendil-works/pi-coding-agent";
import { createGoalStateSnapshot, loadGoalState } from "./state.js";
import { applyGoalUi, renderContinuationStatus } from "./ui.js";
import {
	compactGoalDetails,
	GOAL_CONTEXT_CUSTOM_TYPE,
	renderCompactGoalSummary,
	renderContinuationPrompt,
	renderGoalContext,
} from "./prompts.js";

import type { GoalState } from "./types.js";

export const GOAL_CONTINUATION_CUSTOM_TYPE = "goal-continuation";
export const DEFAULT_GOAL_CONTINUATION_MAX_TURNS = 3;

interface GoalRuntimeContext {
	sessionManager: { getBranch(): Array<{ type: string; customType?: string; data?: unknown }> };
}

type GoalInputEvent = InputEvent & {
	streamingBehavior?: "steer" | "followUp";
	input?: string;
	prompt?: string;
};

interface ContextMessage {
	role?: string;
	customType?: string;
	content?: unknown;
	details?: unknown;
}

interface ContinuationContext extends GoalRuntimeContext {
	isIdle?: () => boolean;
	hasPendingMessages?: () => boolean;
	mode?: "tui" | "rpc" | "json" | "print";
	hasUI?: boolean;
	ui?: {
		setStatus?: (key: string, value: string | undefined) => void;
		setWidget?: (key: string, value: string[] | undefined) => void;
	};
}

interface ContinuationAPI {
	appendEntry(customType: string, data?: unknown): unknown;
	sendUserMessage(message: string, options?: { deliverAs?: "followUp" | "steer" }): unknown;
	getFlag?: (name: string) => unknown;
}

export interface GoalContinuationRecord {
	action: "queued" | "started" | "stopped" | "completed-turn";
	goalId: string;
	at: number;
	reason?: GoalContinuationStopReason;
	turnCount: number;
}

export type GoalContinuationStopReason =
	| "disabled"
	| "not-active"
	| "busy"
	| "pending-messages"
	| "stale-goal"
	| "duplicate-queue"
	| "no-progress"
	| "max-turns"
	| "user-interrupt";

export interface GoalContinuationState {
	queuedGoalId?: string;
	runningGoalId?: string;
	runningStartedAt?: number;
	runningGoalUpdatedAt?: number;
	stoppedGoalId?: string;
	stoppedReason?: GoalContinuationStopReason;
	turnCounts: Map<string, number>;
}

export interface GoalContinuationDecision {
	queued: boolean;
	reason?: GoalContinuationStopReason;
	goalId?: string;
}

export function registerGoalRuntime(pi: ExtensionAPI): void {
	const api = pi as ExtensionAPI & ContinuationAPI;
	const continuationState = createGoalContinuationState();

	api.registerFlag?.("goal-continuation", {
		description: "Opt in to automatic idle continuation for active /goal state",
		type: "boolean",
		default: false,
	});
	api.registerFlag?.("goal-continuation-max-turns", {
		description: "Maximum automatic continuation turns per goal",
		type: "string",
		default: String(DEFAULT_GOAL_CONTINUATION_MAX_TURNS),
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		const goal = loadGoalState(ctx);
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
		const goal = loadGoalState(ctx);
		const messages = event.messages as ContextMessage[];
		return { messages: filterGoalContextMessages(messages, goal) as typeof event.messages };
	});

	pi.on("session_before_compact", async (event) =>
		createGoalCompaction(
			event as {
				preparation: { previousSummary?: string; firstKeptEntryId: string; tokensBefore: number };
				branchEntries: Array<{ type: string; customType?: string; data?: unknown }>;
			},
		),
	);

	pi.on("input", async (event, ctx) => {
		const prompt = getInputText(event as GoalInputEvent);
		if (continuationState.queuedGoalId || continuationState.runningGoalId) {
			if (!isContinuationPrompt(prompt)) {
				stopGoalContinuation(api, continuationState, "user-interrupt");
				updateContinuationStatus(ctx, continuationState);
			}
		}
	});

	pi.on("agent_start", async (_event, ctx) => {
		startQueuedGoalContinuation(api, continuationState, ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		finishRunningGoalContinuation(api, continuationState, ctx);
		await maybeQueueGoalContinuation(api, continuationState, ctx);
	});

	pi.on("session_start", async (_event, ctx) => {
		refreshGoalUi(ctx);
		updateContinuationStatus(ctx, continuationState);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		stopGoalContinuation(api, continuationState, "stale-goal");
		updateContinuationStatus(ctx, continuationState);
	});

	pi.on("session_tree", async (_event, ctx) => {
		stopGoalContinuation(api, continuationState, "stale-goal");
		refreshGoalUi(ctx);
		updateContinuationStatus(ctx, continuationState);
	});
}

export function createGoalContextMessage(goal: GoalState):
	| {
			customType: string;
			content: string;
			display: false;
			details: { goalId: string };
	  }
	| undefined {
	if (!isActiveGoal(goal)) return undefined;
	return {
		customType: GOAL_CONTEXT_CUSTOM_TYPE,
		content: renderGoalContext(goal),
		display: false,
		details: { goalId: goal.goalId },
	};
}

export function filterGoalContextMessages<T extends ContextMessage>(
	messages: T[],
	goal: GoalState | null,
): T[] {
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

export function createGoalContinuationState(): GoalContinuationState {
	return { turnCounts: new Map() };
}

export async function maybeQueueGoalContinuation(
	api: ContinuationAPI,
	state: GoalContinuationState,
	ctx: ContinuationContext,
	now = Date.now(),
): Promise<GoalContinuationDecision> {
	if (api.getFlag?.("goal-continuation") !== true) return stopDecision("disabled");
	if (state.queuedGoalId || state.runningGoalId)
		return stopDecision("duplicate-queue", state.queuedGoalId ?? state.runningGoalId);
	if (ctx.isIdle?.() !== true) return stopDecision("busy");
	if (ctx.hasPendingMessages?.() === true) return stopDecision("pending-messages");

	const goal = loadGoalState(ctx);
	if (!isActiveGoal(goal)) return stopDecision("not-active");
	if (state.stoppedGoalId === goal.goalId && state.stoppedReason === "no-progress")
		return stopDecision("no-progress", goal.goalId);
	if (state.stoppedGoalId === goal.goalId && state.stoppedReason === "user-interrupt")
		return stopDecision("user-interrupt", goal.goalId);
	const maxTurns = getMaxContinuationTurns(api);
	const turnCount = state.turnCounts.get(goal.goalId) ?? 0;
	if (turnCount >= maxTurns) return stopDecision("max-turns", goal.goalId);

	const rechecked = loadGoalState(ctx);
	if (!isActiveGoal(rechecked) || rechecked.goalId !== goal.goalId)
		return stopDecision("stale-goal", goal.goalId);

	state.queuedGoalId = goal.goalId;
	recordGoalContinuation(api, { action: "queued", goalId: goal.goalId, at: now, turnCount });
	updateContinuationStatus(ctx, state);
	api.sendUserMessage(renderContinuationPrompt(goal), { deliverAs: "followUp" });
	return { queued: true, goalId: goal.goalId };
}

export function startQueuedGoalContinuation(
	api: ContinuationAPI,
	state: GoalContinuationState,
	ctx: ContinuationContext,
	now = Date.now(),
): void {
	const goalId = state.queuedGoalId;
	if (!goalId) return;
	const goal = loadGoalState(ctx);
	if (!isActiveGoal(goal) || goal.goalId !== goalId) {
		stopGoalContinuation(api, state, "stale-goal", now);
		updateContinuationStatus(ctx, state);
		return;
	}
	const turnCount = (state.turnCounts.get(goalId) ?? 0) + 1;
	state.turnCounts.set(goalId, turnCount);
	state.queuedGoalId = undefined;
	state.runningGoalId = goalId;
	state.runningStartedAt = now;
	state.runningGoalUpdatedAt = goal.updatedAt;
	state.stoppedGoalId = undefined;
	state.stoppedReason = undefined;
	recordGoalContinuation(api, { action: "started", goalId, at: now, turnCount });
	updateContinuationStatus(ctx, state);
}

export function finishRunningGoalContinuation(
	api: ContinuationAPI,
	state: GoalContinuationState,
	ctx: ContinuationContext,
	now = Date.now(),
): GoalContinuationStopReason | undefined {
	const goalId = state.runningGoalId;
	if (!goalId) return undefined;
	const turnCount = state.turnCounts.get(goalId) ?? 0;
	const goal = loadGoalState(ctx);
	state.runningGoalId = undefined;
	state.runningStartedAt = undefined;
	const previousUpdatedAt = state.runningGoalUpdatedAt;
	state.runningGoalUpdatedAt = undefined;

	if (!isActiveGoal(goal) || goal.goalId !== goalId) {
		const reason: GoalContinuationStopReason = "stale-goal";
		state.stoppedGoalId = goalId;
		state.stoppedReason = reason;
		recordGoalContinuation(api, { action: "stopped", goalId, at: now, turnCount, reason });
		updateContinuationStatus(ctx, state);
		return reason;
	}
	if (previousUpdatedAt !== undefined && goal.updatedAt <= previousUpdatedAt) {
		const reason: GoalContinuationStopReason = "no-progress";
		state.stoppedGoalId = goalId;
		state.stoppedReason = reason;
		recordGoalContinuation(api, { action: "stopped", goalId, at: now, turnCount, reason });
		updateContinuationStatus(ctx, state);
		return reason;
	}
	if (turnCount >= getMaxContinuationTurns(api)) {
		const reason: GoalContinuationStopReason = "max-turns";
		state.stoppedGoalId = goalId;
		state.stoppedReason = reason;
		recordGoalContinuation(api, { action: "stopped", goalId, at: now, turnCount, reason });
		updateContinuationStatus(ctx, state);
		return reason;
	}

	recordGoalContinuation(api, { action: "completed-turn", goalId, at: now, turnCount });
	updateContinuationStatus(ctx, state);
	return undefined;
}

export function stopGoalContinuation(
	api: ContinuationAPI,
	state: GoalContinuationState,
	reason: GoalContinuationStopReason,
	now = Date.now(),
): void {
	const goalId = state.runningGoalId ?? state.queuedGoalId ?? state.stoppedGoalId;
	state.queuedGoalId = undefined;
	state.runningGoalId = undefined;
	state.runningStartedAt = undefined;
	state.runningGoalUpdatedAt = undefined;
	if (!goalId) return;
	state.stoppedGoalId = goalId;
	state.stoppedReason = reason;
	recordGoalContinuation(api, {
		action: "stopped",
		goalId,
		at: now,
		turnCount: state.turnCounts.get(goalId) ?? 0,
		reason,
	});
}

function getInputText(event: GoalInputEvent): string {
	return event.text ?? event.input ?? event.prompt ?? "";
}

function isContinuationPrompt(prompt: string): boolean {
	return prompt.includes("Continue working toward the active goal.");
}

function recordGoalContinuation(api: ContinuationAPI, record: GoalContinuationRecord): void {
	api.appendEntry(GOAL_CONTINUATION_CUSTOM_TYPE, record);
}

function refreshGoalUi(ctx: ContinuationContext): void {
	applyGoalUi(ctx, loadGoalState(ctx));
}

function updateContinuationStatus(ctx: ContinuationContext, state: GoalContinuationState): void {
	if (state.queuedGoalId) {
		ctx.ui?.setStatus?.("goal-continuation", renderContinuationStatus("queued"));
		return;
	}
	if (state.runningGoalId) {
		ctx.ui?.setStatus?.("goal-continuation", renderContinuationStatus("running"));
		return;
	}
	ctx.ui?.setStatus?.("goal-continuation", undefined);
}

function getMaxContinuationTurns(api: ContinuationAPI): number {
	const configured = api.getFlag?.("goal-continuation-max-turns");
	const value =
		typeof configured === "number" ? configured : typeof configured === "string" ? Number(configured) : NaN;
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_GOAL_CONTINUATION_MAX_TURNS;
}

function stopDecision(reason: GoalContinuationStopReason, goalId?: string): GoalContinuationDecision {
	return { queued: false, reason, goalId };
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
