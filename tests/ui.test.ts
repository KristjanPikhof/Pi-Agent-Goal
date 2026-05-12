import { describe, expect, it, vi } from "vitest";
import {
	applyGoalUi,
	formatGoalStatusLabel,
	GOAL_USAGE,
	noGoalMessage,
	nonInteractiveConfirmationMessage,
	renderGoalStatus,
	renderGoalSummary,
	renderGoalWidget,
} from "../src/ui.js";
import { registerGoalRuntime } from "../src/runtime.js";
import { saveGoalState } from "../src/state.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GoalState, GoalStateEntry, GoalStateEvent } from "../src/types.js";

function goal(overrides: Partial<GoalState> = {}): GoalState {
	return {
		version: 1,
		goalId: "goal-1",
		objective: "Ship polished goal UI with helpful summaries",
		status: "active",
		sourceDocs: [
			{ path: "docs/prd.md", kind: "prd", brief: "PRD brief", extractedAt: 1 },
			{ path: "docs/ux.md", kind: "doc", brief: "UX brief", extractedAt: 1 },
			{ path: "docs/extra.md", kind: "doc", brief: "Extra brief", extractedAt: 1 },
		],
		constraints: ["Keep output concise"],
		acceptanceCriteria: ["Footer status reflects state", "Widget shows progress"],
		progress: {
			done: ["state wired"],
			current: "polishing widgets",
			blocked: ["manual TUI smoke pending"],
			lastSummary: "UI helpers implemented",
		},
		createdAt: 1,
		updatedAt: 2,
		owner: "user",
		...overrides,
	};
}

function persist(event: GoalStateEvent, current: GoalState | null) {
	const appendEntry = vi.fn();
	const state = saveGoalState({ appendEntry }, event, current);
	return { entry: appendEntry.mock.calls[0][1] as GoalStateEntry, state };
}

function customEntry(data: GoalStateEntry) {
	return { type: "custom", customType: "goal-state", data };
}

describe("goal UI renderers", () => {
	it("formats footer status for active, paused, complete, and no goal states", () => {
		expect(formatGoalStatusLabel(goal({ status: "active" }))).toBe("goal: active");
		expect(formatGoalStatusLabel(goal({ status: "paused" }))).toBe("goal: paused");
		expect(formatGoalStatusLabel(goal({ status: "complete" }))).toBe("goal: complete");
		expect(formatGoalStatusLabel(null)).toBeUndefined();
	});

	it("renders concise active widgets with progress and source hints", () => {
		expect(renderGoalWidget(goal())).toEqual([
			"goal: active",
			"→ Ship polished goal UI with helpful summaries",
			"now: polishing widgets",
			"criteria: 2",
			"sources: docs/prd.md, docs/ux.md +1",
			"blocked: 1",
		]);
		expect(renderGoalWidget(goal({ status: "paused" }))).toBeUndefined();
		expect(renderGoalWidget(goal({ status: "complete" }))).toBeUndefined();
	});

	it("renders readable summaries and expanded status", () => {
		const summary = renderGoalSummary(goal());
		expect(summary).toContain("Goal: Ship polished goal UI");
		expect(summary).toContain("Status: active");
		expect(summary).toContain("Next actions: /goal status, /goal pause, /goal complete, /goal clear");

		const status = renderGoalStatus(goal());
		expect(status).toContain("Acceptance criteria:\n- Footer status reflects state");
		expect(status).toContain("Current work:\n- polishing widgets");
		expect(status).toContain("Source docs:\n- docs/prd.md (prd): PRD brief");
		expect(status).toContain("Commands:");

		const emptyCriteriaStatus = renderGoalStatus(goal({ acceptanceCriteria: [] }));
		expect(emptyCriteriaStatus).toContain(
			"No acceptance criteria were specified for this goal; use the objective as the source of truth.",
		);
		expect(emptyCriteriaStatus).not.toContain("Acceptance criteria:\n- none");
	});

	it("applies status/widget and no-ops without UI methods", () => {
		const ctx = { ui: { setStatus: vi.fn(), setWidget: vi.fn() } };
		applyGoalUi(ctx, goal());
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("goal", "goal: active");
		expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("goal", expect.arrayContaining(["goal: active"]));

		applyGoalUi(ctx, null);
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("goal", undefined);
		expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("goal", undefined);
		expect(() => applyGoalUi({}, goal())).not.toThrow();
	});

	it("uses actionable usage and error copy", () => {
		expect(GOAL_USAGE).toContain("/goal import <path> [--yes]");
		expect(GOAL_USAGE).toContain("interactive UI can edit before start");
		expect(GOAL_USAGE).toContain("review, edit, or cancel the drafted objective and acceptance criteria");
		expect(GOAL_USAGE).toContain("Non-interactive mode");
		expect(noGoalMessage("pause")).toContain("Start one with /goal <objective>");
		expect(nonInteractiveConfirmationMessage("/goal clear")).toContain("requires --yes");
	});

	it("refreshes footer/widget from branch state on runtime session_start and session_tree", async () => {
		const created = persist({ action: "create", goalId: "goal-1", objective: "Runtime UI", now: 1 }, null);
		const branch = [customEntry(created.entry)];
		const handlers = new Map<string, (event: unknown, ctx?: unknown) => Promise<unknown>>();
		const pi = {
			registerFlag: vi.fn(),
			on: vi.fn((event: string, handler) => handlers.set(event, handler)),
			appendEntry: vi.fn(),
			sendUserMessage: vi.fn(),
			getFlag: vi.fn(() => false),
		} as unknown as ExtensionAPI;
		const ctx = {
			sessionManager: { getBranch: vi.fn(() => branch) },
			ui: { setStatus: vi.fn(), setWidget: vi.fn() },
		};
		registerGoalRuntime(pi);

		await handlers.get("session_start")?.({}, ctx);
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("goal", "goal: active");
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("goal", expect.arrayContaining(["goal: active"]));

		const clear = persist({ action: "clear", goalId: "goal-1", now: 2 }, created.state);
		branch.push(customEntry(clear.entry));
		await handlers.get("session_tree")?.({}, ctx);
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("goal", undefined);
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("goal", undefined);
	});
});
