import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleGoalCommand } from "../../src/commands.js";
import {
	createGoalCompaction,
	createGoalContextMessage,
	createGoalContinuationState,
	filterGoalContextMessages,
	finishRunningGoalContinuation,
	maybeQueueGoalContinuation,
	registerGoalRuntime,
	startQueuedGoalContinuation,
} from "../../src/runtime.js";
import { createGoalStateSnapshot, GOAL_CUSTOM_TYPE, saveGoalState } from "../../src/state.js";
import {
	executeCompleteGoal,
	executeCreateGoal,
	executeGetGoal,
	executeUpdateGoalProgress,
} from "../../src/tools.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GoalState, GoalStateEntry, GoalStateEvent } from "../../src/types.js";

interface BranchEntry {
	type: string;
	customType?: string;
	data?: unknown;
}

function createCommandHarness(branch: BranchEntry[] = [], options: { cwd?: string; hasUI?: boolean } = {}) {
	const pi = {
		appendEntry: vi.fn((customType: string, data: unknown) =>
			branch.push({ type: "custom", customType, data }),
		),
		sendUserMessage: vi.fn(),
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd: options.cwd ?? process.cwd(),
		hasUI: options.hasUI ?? true,
		sessionManager: { getBranch: vi.fn(() => branch) },
		waitForIdle: vi.fn(async () => undefined),
		ui: {
			notify: vi.fn(),
			confirm: vi.fn(async () => true),
			editor: vi.fn(async () => "edited objective"),
			setStatus: vi.fn(),
			setWidget: vi.fn(),
		},
	};
	return { pi, ctx, branch };
}

function persist(event: GoalStateEvent, current: GoalState | null) {
	const appendEntry = vi.fn();
	const state = saveGoalState({ appendEntry }, event, current);
	return { entry: appendEntry.mock.calls[0][1] as GoalStateEntry, state };
}

function customEntry(data: GoalStateEntry): BranchEntry {
	return { type: "custom", customType: GOAL_CUSTOM_TYPE, data };
}

function latestGoal(branch: BranchEntry[]): GoalState | null {
	return createGoalStateSnapshot(branch).current;
}

async function makeWorkspace(): Promise<string> {
	return mkdtemp(path.join(tmpdir(), "pi-goal-lifecycle-"));
}

describe("session lifecycle integration coverage", () => {
	it("covers /goal command lifecycle plus reload, tree, fork, and stale goalId semantics", async () => {
		const { pi, ctx, branch } = createCommandHarness();

		await handleGoalCommand(pi, "ship lifecycle support", ctx);
		expect(latestGoal(branch)).toBeNull();
		expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("propose_goal_draft"));

		const first = saveGoalState(
			pi,
			{ action: "create", goalId: "first", objective: "ship lifecycle support", now: 1 },
			null,
		);
		expect(first).toMatchObject({ objective: "ship lifecycle support", status: "active" });

		const replacement = saveGoalState(
			pi,
			{ action: "replace", goalId: "replacement", objective: "replacement objective", now: 2 },
			first,
		);
		expect(replacement?.goalId).not.toBe(first?.goalId);
		expect(replacement).toMatchObject({ objective: "replacement objective", status: "active" });

		await handleGoalCommand(pi, "edit", ctx);
		expect(latestGoal(branch)?.objective).toBe("edited objective");

		await handleGoalCommand(pi, "pause", ctx);
		expect(latestGoal(branch)?.status).toBe("paused");
		await handleGoalCommand(pi, "resume", ctx);
		expect(latestGoal(branch)?.status).toBe("active");
		await handleGoalCommand(pi, "complete --yes", ctx);
		expect(latestGoal(branch)?.status).toBe("complete");
		await handleGoalCommand(pi, "clear --yes", ctx);
		expect(latestGoal(branch)).toBeNull();
		expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("goal", undefined);

		const create = persist({ action: "create", goalId: "base", objective: "Base goal", now: 1 }, null);
		const progress = persist(
			{ action: "progress", goalId: "base", now: 2, progress: { lastSummary: "fork progress" } },
			create.state,
		);
		const replace = persist(
			{ action: "replace", goalId: "replacement", objective: "Tree goal", now: 3 },
			create.state,
		);
		const stale = persist(
			{ action: "progress", goalId: "base", now: 4, progress: { lastSummary: "stale" } },
			replace.state,
		);
		const forkBranch = [customEntry(create.entry), customEntry(progress.entry)];
		const treeBranch = [customEntry(create.entry), customEntry(replace.entry), customEntry(stale.entry)];

		expect(createGoalStateSnapshot(forkBranch).current).toMatchObject({
			goalId: "base",
			progress: { lastSummary: "fork progress" },
		});
		expect(createGoalStateSnapshot(treeBranch).current).toMatchObject({
			goalId: "replacement",
			objective: "Tree goal",
			progress: { lastSummary: "" },
		});

		const handlers = new Map<string, (event: unknown, ctx?: unknown) => Promise<unknown>>();
		const runtimePi = {
			registerFlag: vi.fn(),
			on: vi.fn((event: string, handler) => handlers.set(event, handler)),
			appendEntry: vi.fn(),
			sendUserMessage: vi.fn(),
			getFlag: vi.fn(() => false),
		} as unknown as ExtensionAPI;
		const runtimeCtx = {
			sessionManager: { getBranch: vi.fn(() => treeBranch) },
			ui: { setStatus: vi.fn(), setWidget: vi.fn() },
		};
		registerGoalRuntime(runtimePi);
		await handlers.get("session_start")?.({ reason: "resume" }, runtimeCtx);
		expect(runtimeCtx.ui.setStatus).toHaveBeenCalledWith("goal", undefined);
		await handlers.get("session_tree")?.({}, runtimeCtx);
		expect(runtimeCtx.ui.setWidget).toHaveBeenCalledWith(
			"goal",
			expect.arrayContaining(["Goal · Active · AC: 0 · Tree goal"]),
		);
	});

	it("covers docs import and model tool boundaries end-to-end", async () => {
		const cwd = await makeWorkspace();
		await mkdir(path.join(cwd, "docs"));
		await writeFile(
			path.join(cwd, "docs/prd.md"),
			"# Objective\nShip imported lifecycle coverage.\n\n# Acceptance Criteria\n- Import creates source docs.\n- Tools preserve scope.\n\n# Constraints\n- Stay safe.",
		);
		const { pi, ctx, branch } = createCommandHarness([], { cwd });

		await handleGoalCommand(pi, "import docs/prd.md --yes", ctx);
		const imported = latestGoal(branch);
		expect(imported).toMatchObject({
			objective: "Ship imported lifecycle coverage.",
			acceptanceCriteria: ["Import creates source docs.", "Tools preserve scope."],
			sourceDocs: [expect.objectContaining({ path: "docs/prd.md" })],
		});

		const toolCtx = { sessionManager: { getBranch: () => branch } };
		expect(executeGetGoal(toolCtx).content[0]?.text).toContain("Ship imported lifecycle coverage");
		const duplicate = executeCreateGoal({ objective: "Rewrite", explicit_request: true }, toolCtx, pi);
		expect(duplicate).toMatchObject({
			details: { status: "refused", reason: "goal_exists" },
		});
		expect(duplicate).not.toHaveProperty("isError");
		expect(
			executeCreateGoal(
				{ objective: "Implicit", explicit_request: false },
				{ sessionManager: { getBranch: () => [] } },
				pi,
			),
		).toMatchObject({
			details: { status: "refused", reason: "permission_denied" },
		});

		const progress = executeUpdateGoalProgress(
			{ done: ["import verified"], current: "checking tools", summary: "tool progress" },
			toolCtx,
			pi,
		);
		expect(progress).not.toHaveProperty("isError");
		expect(latestGoal(branch)?.progress).toMatchObject({ lastSummary: "tool progress" });

		const complete = executeCompleteGoal({ evidence: "all checks passed" }, toolCtx, pi);
		expect(complete.content[0]?.text).toContain("Goal complete");
		expect(latestGoal(branch)?.status).toBe("complete");
	});

	it("covers hidden context, compaction preservation, stale contexts, and continuation safety", async () => {
		const create = persist(
			{
				action: "create",
				goalId: "goal-1",
				objective: "Keep context safe",
				now: 1,
				acceptanceCriteria: ["context survives"],
				sourceDocs: [{ path: "docs/prd.md", kind: "prd", brief: "brief survives", extractedAt: 1 }],
				progress: { lastSummary: "started" },
			},
			null,
		);
		const branch = [customEntry(create.entry)];
		const active = latestGoal(branch);
		expect(active).not.toBeNull();

		const contextMessage = createGoalContextMessage(active!);
		expect(contextMessage?.content).toContain("<goal_context");
		expect(
			filterGoalContextMessages(
				[
					{ customType: "goal-context", content: 'goal_id="old"' },
					{ customType: "goal-context", content: 'goal_id="goal-1" first' },
					{ role: "user", content: "hello" },
					{ customType: "goal-context", content: 'goal_id="goal-1" latest' },
				],
				active,
			),
		).toEqual([
			{ role: "user", content: "hello" },
			{ customType: "goal-context", content: 'goal_id="goal-1" latest' },
		]);

		const compaction = createGoalCompaction({
			branchEntries: branch,
			preparation: { previousSummary: "## Existing summary", firstKeptEntryId: "entry-1", tokensBefore: 100 },
		});
		expect(compaction?.compaction.summary).toContain("Objective: Keep context safe");
		expect(compaction?.compaction.summary).toContain("docs/prd.md: brief survives");
		expect(compaction?.compaction.details.goal).toMatchObject({ goalId: "goal-1" });

		const appendEntry = vi.fn();
		const sendUserMessage = vi.fn();
		const api = {
			appendEntry,
			sendUserMessage,
			getFlag: vi.fn((name: string) => (name === "goal-continuation" ? true : 2)),
		};
		const ctx = {
			sessionManager: { getBranch: vi.fn(() => branch) },
			isIdle: vi.fn(() => true),
			hasPendingMessages: vi.fn(() => false),
			ui: { setStatus: vi.fn(), setWidget: vi.fn() },
		};
		const continuation = createGoalContinuationState();
		await expect(maybeQueueGoalContinuation(api, continuation, ctx, 10)).resolves.toMatchObject({
			queued: true,
			goalId: "goal-1",
		});
		await expect(maybeQueueGoalContinuation(api, continuation, ctx, 11)).resolves.toMatchObject({
			queued: false,
			reason: "duplicate-queue",
		});
		expect(sendUserMessage).toHaveBeenCalledTimes(1);

		const replace = persist(
			{ action: "replace", goalId: "goal-2", objective: "Replacement", now: 2 },
			active,
		);
		branch.push(customEntry(replace.entry));
		startQueuedGoalContinuation(api, continuation, ctx, 20);
		expect(continuation.stoppedReason).toBe("stale-goal");

		const freshBranch = [customEntry(create.entry)];
		ctx.sessionManager.getBranch.mockReturnValue(freshBranch);
		const noProgress = createGoalContinuationState();
		noProgress.queuedGoalId = "goal-1";
		startQueuedGoalContinuation(api, noProgress, ctx, 30);
		expect(finishRunningGoalContinuation(api, noProgress, ctx, 40)).toBe("no-progress");
	});
});
