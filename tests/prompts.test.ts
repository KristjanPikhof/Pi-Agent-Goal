import { describe, expect, it } from "vitest";
import {
	GOAL_CONTEXT_CUSTOM_TYPE,
	renderCompactGoalSummary,
	renderGoalContext,
	renderGoalStartPrompt,
} from "../src/prompts.js";
import { createGoalContextMessage, filterGoalContextMessages } from "../src/runtime.js";

import type { GoalState } from "../src/types.js";

function goal(overrides: Partial<GoalState> = {}): GoalState {
	return {
		version: 1,
		goalId: "goal-1",
		objective: "Ship <runtime> & preserve context",
		status: "active",
		sourceDocs: [
			{
				path: "docs/prd.md",
				kind: "prd",
				brief: "Use <brief> & criteria safely",
				extractedAt: 1,
			},
		],
		constraints: [],
		acceptanceCriteria: ["Escape <xml> & do not rewrite scope"],
		progress: {
			done: ["state"],
			current: "runtime hooks",
			blocked: ["none <really>"],
			lastSummary: "Implementing & testing hidden context",
		},
		createdAt: 1,
		updatedAt: 2,
		owner: "user",
		...overrides,
	};
}

describe("goal prompt rendering", () => {
	it("renders escaped concise hidden goal_context", () => {
		const context = renderGoalContext(goal());

		expect(context).toContain('<goal_context goal_id="goal-1">');
		expect(context).toContain("Objective: Ship &lt;runtime&gt; &amp; preserve context");
		expect(context).toContain("- Escape &lt;xml&gt; &amp; do not rewrite scope");
		expect(context).toContain("docs/prd.md (prd): Use &lt;brief&gt; &amp; criteria safely");
		expect(context).toContain("complete_goal with evidence");
		expect(context).not.toContain("<runtime>");
	});

	it("creates hidden messages only for active goals", () => {
		expect(createGoalContextMessage(goal())).toMatchObject({
			customType: GOAL_CONTEXT_CUSTOM_TYPE,
			display: false,
			details: { goalId: "goal-1" },
		});
		expect(createGoalContextMessage(goal({ status: "paused" }))).toBeUndefined();
		expect(createGoalContextMessage(goal({ status: "complete" }))).toBeUndefined();
	});

	it("filters stale and duplicate hidden goal contexts", () => {
		const current = goal({ goalId: "goal-2" });
		const stale = { role: "custom", customType: GOAL_CONTEXT_CUSTOM_TYPE, content: 'old goal_id="goal-1"' };
		const duplicate = {
			role: "custom",
			customType: GOAL_CONTEXT_CUSTOM_TYPE,
			content: 'first goal_id="goal-2"',
		};
		const fresh = {
			role: "custom",
			customType: GOAL_CONTEXT_CUSTOM_TYPE,
			content: 'latest goal_id="goal-2"',
		};
		const ordinary = { role: "user", content: "hello" };

		expect(filterGoalContextMessages([stale, duplicate, ordinary, fresh], current)).toEqual([
			ordinary,
			fresh,
		]);
		expect(filterGoalContextMessages([fresh, ordinary], goal({ status: "paused" }))).toEqual([ordinary]);
		expect(filterGoalContextMessages([fresh, ordinary], null)).toEqual([ordinary]);
	});

	it("renders start handoff with concrete generated acceptance criteria", () => {
		const prompt = renderGoalStartPrompt(
			goal({ acceptanceCriteria: ["Build the thing", "Tests prove the behavior"] }),
		);

		expect(prompt).toContain("Acceptance criteria:\n- Build the thing\n- Tests prove the behavior");
		expect(prompt).not.toContain("No acceptance criteria were specified");
		expect(prompt).not.toContain("- none");
	});

	it("renders intentional empty acceptance criteria copy in prompts", () => {
		const emptyGoal = goal({ acceptanceCriteria: [] });
		const startPrompt = renderGoalStartPrompt(emptyGoal);
		const context = renderGoalContext(emptyGoal);
		const summary = renderCompactGoalSummary(emptyGoal);

		for (const rendered of [startPrompt, context, summary]) {
			expect(rendered).toContain(
				"No acceptance criteria were specified for this goal; use the objective as the source of truth.",
			);
		}
		expect(startPrompt).not.toContain("Acceptance criteria:\n- none");
		expect(context).not.toContain("Acceptance criteria:\n- none");
		expect(summary).not.toContain("Acceptance criteria:\n- none");
	});

	it("renders compact goal summaries with objective, criteria, source brief, and progress", () => {
		const summary = renderCompactGoalSummary(goal());

		expect(summary).toContain("## Active goal");
		expect(summary).toContain("Objective: Ship <runtime> & preserve context");
		expect(summary).toContain("- Escape <xml> & do not rewrite scope");
		expect(summary).toContain("docs/prd.md: Use <brief> & criteria safely");
		expect(summary).toContain("- Summary: Implementing & testing hidden context");
		expect(summary).toContain("- Done: state");
	});
});
