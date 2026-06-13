import { describe, expect, it, vi } from "vitest";
import {
	createGoalContinuationState,
	finishRunningGoalContinuation,
	GOAL_CONTINUATION_CUSTOM_TYPE,
	maybeQueueGoalContinuation,
	registerGoalRuntime,
	startQueuedGoalContinuation,
} from "../src/runtime.js";
import { saveGoalState } from "../src/state.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GoalState, GoalStateEntry, GoalStateEvent } from "../src/types.js";

function persist(event: GoalStateEvent, current: GoalState | null) {
	const appendEntry = vi.fn();
	const state = saveGoalState({ appendEntry }, event, current);
	return { entry: appendEntry.mock.calls[0][1] as GoalStateEntry, state };
}

function customEntry(data: GoalStateEntry) {
	return { type: "custom", customType: "goal-state", data };
}

function createGoal() {
	return persist(
		{
			action: "create",
			goalId: "goal-1",
			objective: "Finish continuation safely",
			now: 1,
			acceptanceCriteria: ["queues only when idle"],
			progress: { lastSummary: "created" },
		},
		null,
	);
}

function createHarness(
	options: {
		enabled?: boolean;
		maxTurns?: number | string;
		idle?: boolean;
		pending?: boolean;
		branch?: Array<{ type: string; customType?: string; data?: unknown }>;
	} = {},
) {
	const appendEntry = vi.fn();
	const sendUserMessage = vi.fn();
	const ui = { setStatus: vi.fn(), notify: vi.fn() };
	const ctx = {
		sessionManager: { getBranch: vi.fn(() => options.branch ?? []) },
		isIdle: vi.fn(() => options.idle ?? true),
		hasPendingMessages: vi.fn(() => options.pending ?? false),
		ui,
	};
	const api = {
		appendEntry,
		sendUserMessage,
		getFlag: vi.fn((name: string) => {
			if (name === "goal-continuation") return options.enabled ?? false;
			if (name === "goal-continuation-max-turns") return options.maxTurns;
			return undefined;
		}),
	};
	return { api, ctx, appendEntry, sendUserMessage, ui };
}

describe("goal continuation scheduler", () => {
	it("is disabled by default", async () => {
		const created = createGoal();
		const { api, ctx, sendUserMessage } = createHarness({ branch: [customEntry(created.entry)] });
		const state = createGoalContinuationState();

		await expect(maybeQueueGoalContinuation(api, state, ctx, 10)).resolves.toEqual({
			queued: false,
			reason: "disabled",
		});
		expect(sendUserMessage).not.toHaveBeenCalled();
	});

	it("queues an opt-in continuation only when active, idle, and no pending messages exist", async () => {
		const created = createGoal();
		const { api, ctx, appendEntry, sendUserMessage, ui } = createHarness({
			enabled: true,
			branch: [customEntry(created.entry)],
		});
		const state = createGoalContinuationState();

		const decision = await maybeQueueGoalContinuation(api, state, ctx, 10);

		expect(decision).toEqual({ queued: true, goalId: "goal-1" });
		expect(sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("Continue working toward the active goal."),
			{ deliverAs: "followUp" },
		);
		expect(appendEntry).toHaveBeenCalledWith(
			GOAL_CONTINUATION_CUSTOM_TYPE,
			expect.objectContaining({ action: "queued", goalId: "goal-1", turnCount: 0 }),
		);
		expect(ui.setStatus).toHaveBeenLastCalledWith("goal-continuation", "goal: continuation queued");
	});

	it("does not queue while busy or while user messages are pending", async () => {
		const created = createGoal();
		const busy = createHarness({ enabled: true, idle: false, branch: [customEntry(created.entry)] });
		await expect(
			maybeQueueGoalContinuation(busy.api, createGoalContinuationState(), busy.ctx),
		).resolves.toMatchObject({
			queued: false,
			reason: "busy",
		});

		const pending = createHarness({ enabled: true, pending: true, branch: [customEntry(created.entry)] });
		await expect(
			maybeQueueGoalContinuation(pending.api, createGoalContinuationState(), pending.ctx),
		).resolves.toMatchObject({ queued: false, reason: "pending-messages" });
	});

	it("does not queue for paused, complete, or cleared goals", async () => {
		const created = createGoal();
		const paused = persist({ action: "pause", goalId: "goal-1", now: 2 }, created.state);
		const completed = persist({ action: "complete", goalId: "goal-1", now: 3 }, created.state);
		const cleared = persist({ action: "clear", goalId: "goal-1", now: 4 }, created.state);

		for (const entry of [paused.entry, completed.entry, cleared.entry]) {
			const { api, ctx } = createHarness({
				enabled: true,
				branch: [customEntry(created.entry), customEntry(entry)],
			});
			await expect(
				maybeQueueGoalContinuation(api, createGoalContinuationState(), ctx),
			).resolves.toMatchObject({
				queued: false,
				reason: "not-active",
			});
		}
	});

	it("prevents duplicate queueing", async () => {
		const created = createGoal();
		const { api, ctx, sendUserMessage } = createHarness({
			enabled: true,
			branch: [customEntry(created.entry)],
		});
		const state = createGoalContinuationState();

		await maybeQueueGoalContinuation(api, state, ctx);
		await expect(maybeQueueGoalContinuation(api, state, ctx)).resolves.toMatchObject({
			queued: false,
			reason: "duplicate-queue",
			goalId: "goal-1",
		});
		expect(sendUserMessage).toHaveBeenCalledTimes(1);
	});

	it("re-checks goalId before marking queued continuation as running", () => {
		const created = createGoal();
		const replacement = persist(
			{ action: "replace", goalId: "goal-2", objective: "Replacement", now: 2 },
			created.state,
		);
		const state = createGoalContinuationState();
		state.queuedGoalId = "goal-1";
		const { api, ctx, appendEntry } = createHarness({
			enabled: true,
			branch: [customEntry(created.entry), customEntry(replacement.entry)],
		});

		startQueuedGoalContinuation(api, state, ctx, 20);

		expect(state.runningGoalId).toBeUndefined();
		expect(state.stoppedReason).toBe("stale-goal");
		expect(appendEntry).toHaveBeenCalledWith(
			GOAL_CONTINUATION_CUSTOM_TYPE,
			expect.objectContaining({ action: "stopped", goalId: "goal-1", reason: "stale-goal" }),
		);
	});

	it("marks a queued continuation running and updates UI", () => {
		const created = createGoal();
		const state = createGoalContinuationState();
		state.queuedGoalId = "goal-1";
		const { api, ctx, ui } = createHarness({ enabled: true, branch: [customEntry(created.entry)] });

		startQueuedGoalContinuation(api, state, ctx, 20);

		expect(state.runningGoalId).toBe("goal-1");
		expect(state.queuedGoalId).toBeUndefined();
		expect(ui.setStatus).toHaveBeenLastCalledWith("goal-continuation", "goal: continuation running");
	});

	it("stops running continuation when the goal is paused, completed, cleared, or replaced", () => {
		const created = createGoal();
		const paused = persist({ action: "pause", goalId: "goal-1", now: 2 }, created.state);
		const completed = persist({ action: "complete", goalId: "goal-1", now: 3 }, created.state);
		const cleared = persist({ action: "clear", goalId: "goal-1", now: 4 }, created.state);
		const replaced = persist(
			{ action: "replace", goalId: "goal-2", objective: "Replacement", now: 5 },
			created.state,
		);

		for (const entry of [paused.entry, completed.entry, cleared.entry, replaced.entry]) {
			const branch = [customEntry(created.entry)];
			const state = createGoalContinuationState();
			state.queuedGoalId = "goal-1";
			const { api, ctx } = createHarness({ enabled: true, branch });
			startQueuedGoalContinuation(api, state, ctx, 20);
			branch.push(customEntry(entry));

			expect(finishRunningGoalContinuation(api, state, ctx, 30)).toBe("stale-goal");
			expect(state.stoppedReason).toBe("stale-goal");
		}
	});

	it("stops after a continuation turn with no progress", () => {
		const created = createGoal();
		const state = createGoalContinuationState();
		state.queuedGoalId = "goal-1";
		const { api, ctx } = createHarness({ enabled: true, branch: [customEntry(created.entry)] });
		startQueuedGoalContinuation(api, state, ctx, 20);

		const reason = finishRunningGoalContinuation(api, state, ctx, 30);

		expect(reason).toBe("no-progress");
		expect(state.stoppedReason).toBe("no-progress");
		expect(api.appendEntry).toHaveBeenLastCalledWith(
			GOAL_CONTINUATION_CUSTOM_TYPE,
			expect.objectContaining({ action: "stopped", reason: "no-progress", turnCount: 1 }),
		);
	});

	it("continues after progress but stops at max turn cap", async () => {
		const created = createGoal();
		const progress = persist(
			{
				action: "progress",
				goalId: "goal-1",
				now: 2,
				progress: { lastSummary: "made progress" },
			},
			created.state,
		);
		const branch = [customEntry(created.entry)];
		const state = createGoalContinuationState();
		state.queuedGoalId = "goal-1";
		const { api, ctx } = createHarness({
			enabled: true,
			maxTurns: "1",
			branch,
		});
		startQueuedGoalContinuation(api, state, ctx, 20);
		branch.push(customEntry(progress.entry));
		const reason = finishRunningGoalContinuation(api, state, ctx, 30);

		expect(reason).toBe("max-turns");
		await expect(maybeQueueGoalContinuation(api, state, ctx)).resolves.toMatchObject({
			queued: false,
			reason: "max-turns",
		});
	});

	it("registered hooks respect queued follow-ups before scheduling another continuation", async () => {
		const handlers = new Map<string, (event: unknown, ctx?: unknown) => Promise<unknown>>();
		const pi = {
			registerFlag: vi.fn(),
			on: vi.fn((event: string, handler) => handlers.set(event, handler)),
			appendEntry: vi.fn(),
			sendUserMessage: vi.fn(),
			getFlag: vi.fn((name: string) => (name === "goal-continuation" ? true : undefined)),
		} as unknown as ExtensionAPI;
		const created = createGoal();
		const ctx = {
			sessionManager: { getBranch: vi.fn(() => [customEntry(created.entry)]) },
			isIdle: vi.fn(() => true),
			hasPendingMessages: vi.fn(() => true),
			ui: { setStatus: vi.fn() },
		};

		registerGoalRuntime(pi);
		await handlers.get("agent_end")?.({}, ctx);
		expect(
			(pi as unknown as { sendUserMessage: ReturnType<typeof vi.fn> }).sendUserMessage,
		).not.toHaveBeenCalled();

		ctx.hasPendingMessages.mockReturnValue(false);
		await handlers.get("agent_end")?.({}, ctx);
		expect(
			(pi as unknown as { sendUserMessage: ReturnType<typeof vi.fn> }).sendUserMessage,
		).toHaveBeenCalledWith(expect.stringContaining("Continue working toward the active goal."), {
			deliverAs: "followUp",
		});
	});

	it("registered hooks stop queued/running continuations on current Pi text input", async () => {
		const handlers = new Map<string, (event: unknown, ctx?: unknown) => Promise<unknown>>();
		const pi = {
			registerFlag: vi.fn(),
			on: vi.fn((event: string, handler) => handlers.set(event, handler)),
			appendEntry: vi.fn(),
			sendUserMessage: vi.fn(),
			getFlag: vi.fn((name: string) => (name === "goal-continuation" ? true : undefined)),
		} as unknown as ExtensionAPI;
		const created = createGoal();
		const ctx = {
			sessionManager: { getBranch: vi.fn(() => [customEntry(created.entry)]) },
			isIdle: vi.fn(() => true),
			hasPendingMessages: vi.fn(() => false),
			ui: { setStatus: vi.fn() },
		};
		registerGoalRuntime(pi);
		expect((pi as unknown as { registerFlag: ReturnType<typeof vi.fn> }).registerFlag).toHaveBeenCalledWith(
			"goal-continuation-max-turns",
			expect.objectContaining({ type: "string", default: "3" }),
		);

		await handlers.get("agent_end")?.({}, ctx);
		expect(
			(pi as unknown as { sendUserMessage: ReturnType<typeof vi.fn> }).sendUserMessage,
		).toHaveBeenCalledOnce();
		await handlers.get("input")?.(
			{ type: "input", text: "user interrupts", source: "interactive", streamingBehavior: "followUp" },
			ctx,
		);

		expect((pi as unknown as { appendEntry: ReturnType<typeof vi.fn> }).appendEntry).toHaveBeenLastCalledWith(
			GOAL_CONTINUATION_CUSTOM_TYPE,
			expect.objectContaining({ action: "stopped", reason: "user-interrupt" }),
		);
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("goal-continuation", undefined);
	});

	it("keeps deliberate legacy input fallback and clears queued state on shutdown", async () => {
		const handlers = new Map<string, (event: unknown, ctx?: unknown) => Promise<unknown>>();
		const pi = {
			registerFlag: vi.fn(),
			on: vi.fn((event: string, handler) => handlers.set(event, handler)),
			appendEntry: vi.fn(),
			sendUserMessage: vi.fn(),
			getFlag: vi.fn((name: string) => (name === "goal-continuation" ? true : undefined)),
		} as unknown as ExtensionAPI;
		const created = createGoal();
		const ctx = {
			sessionManager: { getBranch: vi.fn(() => [customEntry(created.entry)]) },
			isIdle: vi.fn(() => true),
			hasPendingMessages: vi.fn(() => false),
			ui: { setStatus: vi.fn() },
		};

		registerGoalRuntime(pi);
		await handlers.get("agent_end")?.({}, ctx);
		await handlers.get("input")?.({ input: "Continue working toward the active goal." }, ctx);
		expect(
			(pi as unknown as { appendEntry: ReturnType<typeof vi.fn> }).appendEntry,
		).not.toHaveBeenLastCalledWith(
			GOAL_CONTINUATION_CUSTOM_TYPE,
			expect.objectContaining({ action: "stopped", reason: "user-interrupt" }),
		);

		await handlers.get("session_shutdown")?.({ reason: "reload" }, ctx);
		expect((pi as unknown as { appendEntry: ReturnType<typeof vi.fn> }).appendEntry).toHaveBeenLastCalledWith(
			GOAL_CONTINUATION_CUSTOM_TYPE,
			expect.objectContaining({ action: "stopped", reason: "stale-goal" }),
		);
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("goal-continuation", undefined);
	});
});
