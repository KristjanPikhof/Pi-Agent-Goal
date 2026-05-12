import { describe, expect, it, vi } from "vitest";
import {
	createGoalStateSnapshot,
	getCurrentGoal,
	GOAL_CUSTOM_TYPE,
	loadGoalState,
	MAX_OBJECTIVE_LENGTH,
	reduceGoalState,
	saveGoalState,
} from "../src/state.js";

import type { GoalSourceDoc, GoalState, GoalStateEvent, GoalStateEntry } from "../src/types.js";

const baseTime = 1_700_000_000_000;

function createEvent(goalId = "goal-1", objective = "Ship the feature"): GoalStateEvent {
	return { action: "create", goalId, objective, now: baseTime, owner: "user" };
}

function customEntry(data: GoalStateEntry, id = crypto.randomUUID()) {
	return { type: "custom", id, customType: GOAL_CUSTOM_TYPE, data };
}

function messageEntry(id = crypto.randomUUID()) {
	return { type: "message", id, message: { role: "user", content: "not goal state" } };
}

function persist(
	event: GoalStateEvent,
	current: GoalState | null,
): { entry: GoalStateEntry; state: GoalState | null } {
	const appendEntry = vi.fn();
	const state = saveGoalState({ appendEntry }, event, current);
	return { entry: appendEntry.mock.calls[0][1] as GoalStateEntry, state };
}

describe("goal state reducer", () => {
	it("supports create, edit, pause, resume, progress, import-docs, complete, clear, and replace", () => {
		let state = reduceGoalState(null, createEvent());
		expect(state).toMatchObject({ goalId: "goal-1", objective: "Ship the feature", status: "active" });

		state = reduceGoalState(state, {
			action: "edit",
			goalId: "goal-1",
			now: baseTime + 1,
			objective: "Ship the polished feature",
			constraints: ["stay scoped"],
			acceptanceCriteria: ["tests pass"],
		});
		expect(state?.objective).toBe("Ship the polished feature");
		expect(state?.constraints).toEqual(["stay scoped"]);
		expect(state?.acceptanceCriteria).toEqual(["tests pass"]);

		state = reduceGoalState(state, { action: "pause", goalId: "goal-1", now: baseTime + 2 });
		expect(state?.status).toBe("paused");

		state = reduceGoalState(state, { action: "resume", goalId: "goal-1", now: baseTime + 3 });
		expect(state?.status).toBe("active");

		state = reduceGoalState(state, {
			action: "progress",
			goalId: "goal-1",
			now: baseTime + 4,
			progress: { done: ["scaffold"], current: "state", blocked: [], lastSummary: "Working" },
		});
		expect(state?.progress).toEqual({
			done: ["scaffold"],
			current: "state",
			blocked: [],
			lastSummary: "Working",
		});

		const sourceDoc: GoalSourceDoc = {
			path: "docs/prd.md",
			kind: "prd",
			brief: "Goal brief",
			extractedAt: baseTime + 5,
		};
		state = reduceGoalState(state, {
			action: "import-docs",
			goalId: "goal-1",
			now: baseTime + 5,
			sourceDocs: [sourceDoc],
			acceptanceCriteria: ["criteria from docs"],
		});
		expect(state?.sourceDocs).toEqual([sourceDoc]);
		expect(state?.acceptanceCriteria).toEqual(["criteria from docs"]);

		state = reduceGoalState(state, { action: "complete", goalId: "goal-1", now: baseTime + 6 });
		expect(state).toMatchObject({ status: "complete", completedAt: baseTime + 6 });

		state = reduceGoalState(state, { action: "clear", goalId: "goal-1", now: baseTime + 7 });
		expect(state).toBeNull();

		state = reduceGoalState(state, {
			action: "replace",
			goalId: "goal-2",
			objective: "Next goal",
			now: baseTime + 8,
		});
		expect(state).toMatchObject({ goalId: "goal-2", objective: "Next goal", status: "active" });
	});

	it("treats complete goals as terminal until clear or replace", () => {
		let state = reduceGoalState(null, createEvent("goal-1", "Terminal"));
		state = reduceGoalState(state, { action: "complete", goalId: "goal-1", now: baseTime + 1 });
		expect(state).toMatchObject({ status: "complete", completedAt: baseTime + 1 });

		state = reduceGoalState(state, { action: "resume", goalId: "goal-1", now: baseTime + 2 });
		expect(state).toMatchObject({ status: "complete", completedAt: baseTime + 1 });

		state = reduceGoalState(state, {
			action: "progress",
			goalId: "goal-1",
			now: baseTime + 3,
			progress: { done: ["late"], lastSummary: "late" },
		});
		expect(state?.progress.done).toEqual([]);
		expect(state?.progress.lastSummary).toBe("");

		state = reduceGoalState(state, { action: "clear", goalId: "goal-1", now: baseTime + 4 });
		expect(state).toBeNull();

		state = reduceGoalState(state, {
			action: "replace",
			goalId: "goal-2",
			objective: "Replacement",
			now: baseTime + 5,
		});
		expect(state).toMatchObject({ goalId: "goal-2", status: "active" });
	});

	it("ignores pause, complete, and progress for inactive paused goals until resume", () => {
		let state = reduceGoalState(null, createEvent("goal-1", "Pause semantics"));
		state = reduceGoalState(state, { action: "pause", goalId: "goal-1", now: baseTime + 1 });
		expect(state?.status).toBe("paused");

		state = reduceGoalState(state, { action: "pause", goalId: "goal-1", now: baseTime + 2 });
		expect(state?.updatedAt).toBe(baseTime + 1);

		state = reduceGoalState(state, { action: "complete", goalId: "goal-1", now: baseTime + 3 });
		expect(state?.status).toBe("paused");

		state = reduceGoalState(state, {
			action: "progress",
			goalId: "goal-1",
			now: baseTime + 4,
			progress: { done: ["late"], lastSummary: "late" },
		});
		expect(state?.progress.done).toEqual([]);

		state = reduceGoalState(state, { action: "resume", goalId: "goal-1", now: baseTime + 5 });
		expect(state?.status).toBe("active");
	});

	it("ignores stale goalId mutations after replacement", () => {
		let state = reduceGoalState(null, createEvent("goal-1", "First"));
		state = reduceGoalState(state, {
			action: "replace",
			goalId: "goal-2",
			objective: "Second",
			now: baseTime + 1,
		});

		state = reduceGoalState(state, {
			action: "progress",
			goalId: "goal-1",
			now: baseTime + 2,
			progress: { done: ["stale"], lastSummary: "stale" },
		});
		state = reduceGoalState(state, { action: "complete", goalId: "goal-1", now: baseTime + 3 });

		expect(state).toMatchObject({ goalId: "goal-2", status: "active" });
		expect(state?.progress.done).toEqual([]);
	});

	it("validates trimmed, non-empty objectives and maximum length", () => {
		expect(() => reduceGoalState(null, createEvent("goal-1", "   "))).toThrow("non-empty");
		expect(() => reduceGoalState(null, createEvent("goal-1", "x".repeat(MAX_OBJECTIVE_LENGTH + 1)))).toThrow(
			"4000",
		);
		expect(reduceGoalState(null, createEvent("goal-1", "  valid objective  "))?.objective).toBe(
			"valid objective",
		);
	});
});

describe("goal state persistence helpers", () => {
	it("saves appendEntry payloads and returns the current snapshot", () => {
		const appendEntry = vi.fn();
		const state = saveGoalState({ appendEntry }, createEvent(), null);

		expect(state?.objective).toBe("Ship the feature");
		expect(appendEntry).toHaveBeenCalledWith(
			GOAL_CUSTOM_TYPE,
			expect.objectContaining({ action: "create", state: expect.objectContaining({ goalId: "goal-1" }) }),
		);
	});

	it("reconstructs only from current branch goal-state custom entries", () => {
		const first = persist(createEvent("goal-1", "Branch goal"), null);
		const ignoredOtherCustom = { type: "custom", customType: "other-extension", data: first.entry };
		const progress = persist(
			{
				action: "progress",
				goalId: "goal-1",
				now: baseTime + 1,
				progress: { done: ["branch-only"], lastSummary: "done on branch" },
			},
			first.state,
		);
		const unselectedBranch = persist(createEvent("goal-other", "Other branch"), null);

		const snapshot = createGoalStateSnapshot([
			messageEntry(),
			customEntry(first.entry),
			ignoredOtherCustom,
			customEntry(progress.entry),
		]);

		expect(snapshot.current?.goalId).toBe("goal-1");
		expect(snapshot.current?.progress.done).toEqual(["branch-only"]);
		expect(snapshot.entries).toHaveLength(2);
		expect(createGoalStateSnapshot([customEntry(unselectedBranch.entry)]).current?.goalId).toBe("goal-other");
	});

	it("loads from ctx.sessionManager.getBranch for reload-like restore", () => {
		const create = persist(createEvent("goal-1", "Reloaded goal"), null);
		const pause = persist({ action: "pause", goalId: "goal-1", now: baseTime + 1 }, create.state);
		const getBranch = vi.fn(() => [customEntry(create.entry), customEntry(pause.entry)]);

		const loaded = loadGoalState({ sessionManager: { getBranch } });

		expect(getBranch).toHaveBeenCalledOnce();
		expect(loaded).toMatchObject({ goalId: "goal-1", objective: "Reloaded goal", status: "paused" });
	});

	it("returns cloned current snapshots", () => {
		const create = persist(createEvent(), null);
		const snapshot = createGoalStateSnapshot([customEntry(create.entry)]);
		const current = getCurrentGoal(snapshot);
		current?.progress.done.push("mutated");

		expect(snapshot.current?.progress.done).toEqual([]);
	});
});
