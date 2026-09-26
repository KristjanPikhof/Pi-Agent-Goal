import { describe, expect, it, vi } from "vitest";
import { registerGoalRuntime } from "../src/runtime.js";
import { GOAL_SYSTEM_PROMPT_SECTION } from "../src/prompts.js";
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

function createRuntimeHarness(branch: Array<{ type: string; customType?: string; data?: unknown }>) {
	const handlers = new Map<string, (event: unknown, ctx?: unknown) => Promise<unknown>>();
	const pi = {
		on: vi.fn((event: string, handler) => handlers.set(event, handler)),
	} as unknown as ExtensionAPI;
	const ctx = { sessionManager: { getBranch: vi.fn(() => branch) } };
	registerGoalRuntime(pi);
	return { handlers, ctx, pi };
}

describe("goal runtime hooks", () => {
	it("updates the goal system section for active goals and filters legacy context", async () => {
		const create = persist(
			{
				action: "create",
				goalId: "goal-1",
				objective: "Preserve context",
				now: 1,
				acceptanceCriteria: ["inject context"],
			},
			null,
		);
		const branch = [customEntry(create.entry)];
		const { handlers, ctx } = createRuntimeHarness(branch);

		const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
		await handlers.get("before_agent_start")?.(event, ctx);
		expect(event.systemPromptOptions.sections).toHaveProperty(GOAL_SYSTEM_PROMPT_SECTION);
		expect(event.systemPromptOptions.sections.goal).toContain("Objective: Preserve context");

		const filtered = (await handlers.get("context")?.(
			{
				messages: [
					{ role: "custom", customType: "goal-context", content: 'goal_id="old"' },
					{ role: "custom", customType: "goal-context", content: 'goal_id="goal-1" first' },
					{ role: "user", content: "hello" },
					{ role: "custom", customType: "goal-context", content: 'goal_id="goal-1" latest' },
				],
			},
			ctx,
		)) as { messages: unknown[] };
		expect(filtered.messages).toEqual([
			{ role: "user", content: "hello" },
			{ role: "custom", customType: "goal-context", content: 'goal_id="goal-1" latest' },
		]);
	});

	it("does not inject context for paused, complete, or cleared goals", async () => {
		const create = persist({ action: "create", goalId: "goal-1", objective: "Goal", now: 1 }, null);
		const pause = persist({ action: "pause", goalId: "goal-1", now: 2 }, create.state);
		const pausedHarness = createRuntimeHarness([customEntry(create.entry), customEntry(pause.entry)]);
		const pausedEvent = { systemPromptOptions: { sections: {} as Record<string, string> } };
		expect(
			await pausedHarness.handlers.get("before_agent_start")?.(pausedEvent, pausedHarness.ctx),
		).toBeUndefined();
		expect(pausedEvent.systemPromptOptions.sections).not.toHaveProperty(GOAL_SYSTEM_PROMPT_SECTION);

		const complete = persist({ action: "complete", goalId: "goal-1", now: 3 }, create.state);
		const completeHarness = createRuntimeHarness([customEntry(create.entry), customEntry(complete.entry)]);
		const completeEvent = { systemPromptOptions: { sections: {} as Record<string, string> } };
		expect(
			await completeHarness.handlers.get("before_agent_start")?.(completeEvent, completeHarness.ctx),
		).toBeUndefined();
		expect(completeEvent.systemPromptOptions.sections).not.toHaveProperty(GOAL_SYSTEM_PROMPT_SECTION);

		const clear = persist({ action: "clear", goalId: "goal-1", now: 4 }, create.state);
		const clearHarness = createRuntimeHarness([customEntry(create.entry), customEntry(clear.entry)]);
		const clearEvent = { systemPromptOptions: { sections: {} as Record<string, string> } };
		expect(
			await clearHarness.handlers.get("before_agent_start")?.(clearEvent, clearHarness.ctx),
		).toBeUndefined();
		expect(clearEvent.systemPromptOptions.sections).not.toHaveProperty(GOAL_SYSTEM_PROMPT_SECTION);
	});

	it("preserves active goal details during compaction", async () => {
		const create = persist(
			{
				action: "create",
				goalId: "goal-1",
				objective: "Compact safely",
				now: 1,
				acceptanceCriteria: ["criteria survives"],
				sourceDocs: [{ path: "docs/prd.md", kind: "prd", brief: "brief survives", extractedAt: 1 }],
				progress: { done: ["done survives"], current: "current survives", lastSummary: "summary survives" },
			},
			null,
		);
		const { handlers } = createRuntimeHarness([customEntry(create.entry)]);

		const result = (await handlers.get("session_before_compact")?.({
			branchEntries: [customEntry(create.entry)],
			preparation: {
				previousSummary: "## Previous\nKeep this.",
				firstKeptEntryId: "entry-1",
				tokensBefore: 123,
			},
		})) as {
			compaction: { summary: string; details: unknown; firstKeptEntryId: string; tokensBefore: number };
		};

		expect(result.compaction).toMatchObject({ firstKeptEntryId: "entry-1", tokensBefore: 123 });
		expect(result.compaction.summary).toContain("## Previous\nKeep this.");
		expect(result.compaction.summary).toContain("Objective: Compact safely");
		expect(result.compaction.summary).toContain("criteria survives");
		expect(result.compaction.summary).toContain("docs/prd.md: brief survives");
		expect(result.compaction.summary).toContain("summary survives");
		expect(result.compaction.details).toMatchObject({
			goal: {
				goalId: "goal-1",
				objective: "Compact safely",
				acceptanceCriteria: ["criteria survives"],
				sourceDocs: [{ path: "docs/prd.md", brief: "brief survives" }],
				progress: { done: ["done survives"], current: "current survives", lastSummary: "summary survives" },
			},
		});
	});

	it("skips custom compaction when no active goal exists", async () => {
		const { handlers } = createRuntimeHarness([]);
		await expect(
			handlers.get("session_before_compact")?.({
				branchEntries: [],
				preparation: { firstKeptEntryId: "entry-1", tokensBefore: 123 },
			}),
		).resolves.toBeUndefined();
	});
});
