import { describe, expect, it, vi } from "vitest";
import {
	applyGoalUi,
	createGoalWidgetFactory,
	createGoalWidgetPresentation,
	getGoalSymbols,
	GOAL_USAGE,
	noGoalMessage,
	nonInteractiveConfirmationMessage,
	renderGoalStatus,
	renderGoalSummary,
	renderGoalWidget,
	renderGoalWidgetPresentation,
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
		acceptanceCriteria: ["Status command reflects state", "Widget shows progress"],
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
	it("renders compact active widgets with semantic data, symbols, and optional blocked/current lines", () => {
		const presentation = createGoalWidgetPresentation(goal());
		expect(presentation).toMatchObject({
			status: "active",
			acceptanceCount: 2,
			blockedCount: 1,
			completedCount: 1,
			current: "polishing widgets",
		});
		expect(renderGoalWidget(goal())).toEqual([
			"Goal · Active · AC: 2 · Blocked: 1 · ✓ 1 · Ship polished goal UI with helpful summaries",
			"Now · polishing widgets",
		]);

		expect(
			renderGoalWidget(
				goal({
					acceptanceCriteria: [],
					progress: { done: [], current: "", blocked: [], lastSummary: "UI helpers implemented" },
				}),
			),
		).toEqual(["Goal · Active · AC: 0 · Ship polished goal UI with helpful summaries"]);
		expect(
			renderGoalWidgetPresentation(createGoalWidgetPresentation(goal())!, {
				symbols: getGoalSymbols({ ascii: true }),
			}),
		).toEqual([
			"Goal - Active - AC: 2 - Blocked: 1 - [x] 1 - Ship polished goal UI with helpful summaries",
			"Now - polishing widgets",
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
		expect(status).toContain("Acceptance criteria:\n- Status command reflects state");
		expect(status).toContain("Progress done:\n✓ state wired");
		expect(status).toContain("Current work:\n- polishing widgets");
		expect(status).toContain("Source docs:\n- docs/prd.md (prd): PRD brief");
		expect(status).toContain("Commands:");

		const emptyCriteriaStatus = renderGoalStatus(goal({ acceptanceCriteria: [] }));
		expect(emptyCriteriaStatus).toContain(
			"No acceptance criteria were specified for this goal; use the objective as the source of truth.",
		);
		expect(emptyCriteriaStatus).not.toContain("Acceptance criteria:\n- none");
	});

	it("clears footer status while applying widgets and no-ops without UI methods", () => {
		const ctx = { ui: { setStatus: vi.fn(), setWidget: vi.fn() } };
		applyGoalUi(ctx, goal());
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("goal", undefined);
		expect(ctx.ui.setWidget).toHaveBeenLastCalledWith(
			"goal",
			expect.arrayContaining([
				"Goal · Active · AC: 2 · Blocked: 1 · ✓ 1 · Ship polished goal UI with helpful summaries",
			]),
		);

		applyGoalUi(ctx, goal({ status: "complete" }));
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("goal", undefined);
		expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("goal", undefined);

		applyGoalUi(ctx, null);
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("goal", undefined);
		expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("goal", undefined);
		expect(() => applyGoalUi({}, goal())).not.toThrow();
	});

	it("renders themed widget components with width-safe output and invalidation support", () => {
		const presentation = createGoalWidgetPresentation(goal())!;
		const fg = vi.fn((_token: string, text: string) => text);
		const bold = vi.fn((text: string) => text);
		const component = createGoalWidgetFactory(presentation)({}, { fg, bold });
		const lines = component.render(42);

		expect(fg).toHaveBeenCalledWith("customMessageLabel", "Goal");
		expect(fg).toHaveBeenCalledWith("success", "Active");
		expect(fg).toHaveBeenCalledWith("muted", "AC: 2");
		expect(fg).toHaveBeenCalledWith("warning", "Blocked: 1");
		expect(fg).toHaveBeenCalledWith("success", "✓ 1");
		expect(fg).toHaveBeenCalledWith("accent", "Now");
		expect(lines.every((line) => line.length <= 42)).toBe(true);
		expect(() => component.invalidate()).not.toThrow();
	});

	it("uses themed widget path only in TUI and legacy string fallback elsewhere", () => {
		const tuiCtx = { mode: "tui" as const, ui: { setStatus: vi.fn(), setWidget: vi.fn() } };
		applyGoalUi(tuiCtx, goal());
		expect(tuiCtx.ui.setWidget).toHaveBeenLastCalledWith("goal", expect.any(Function));

		const rpcCtx = { mode: "rpc" as const, ui: { setStatus: vi.fn(), setWidget: vi.fn() } };
		applyGoalUi(rpcCtx, goal());
		expect(rpcCtx.ui.setWidget).toHaveBeenLastCalledWith("goal", expect.any(Array));
	});

	it("uses actionable usage and error copy", () => {
		expect(GOAL_USAGE).toContain("/goal import <path> [--yes]");
		expect(GOAL_USAGE).toContain("interactive UI can edit before start");
		expect(GOAL_USAGE).toContain("review, edit, or cancel the drafted objective and acceptance criteria");
		expect(GOAL_USAGE).toContain("Non-interactive mode");
		expect(noGoalMessage("pause")).toContain("Start one with /goal <objective>");
		expect(nonInteractiveConfirmationMessage("/goal clear")).toContain("requires --yes");
	});

	it("clears footer status and refreshes widget from branch state on runtime session_start and session_tree", async () => {
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
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("goal", undefined);
		expect(ctx.ui.setWidget).toHaveBeenCalledWith(
			"goal",
			expect.arrayContaining(["Goal · Active · AC: 0 · Runtime UI"]),
		);

		const clear = persist({ action: "clear", goalId: "goal-1", now: 2 }, created.state);
		branch.push(customEntry(clear.entry));
		await handlers.get("session_tree")?.({}, ctx);
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("goal", undefined);
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("goal", undefined);
	});
});
