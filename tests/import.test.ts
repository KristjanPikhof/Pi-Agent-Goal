import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleGoalCommand, parseGoalCommand } from "../src/commands.js";
import { extractGoalBrief, importGoalSources } from "../src/import.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GoalStateEntry } from "../src/types.js";

async function makeWorkspace(): Promise<string> {
	return mkdtemp(path.join(tmpdir(), "pi-goal-import-"));
}

function createHarness(cwd: string, options: { hasUI?: boolean; confirm?: boolean } = {}) {
	const branch: Array<{ type: string; customType?: string; data?: unknown }> = [];
	const pi = {
		appendEntry: vi.fn((customType: string, data: unknown) =>
			branch.push({ type: "custom", customType, data }),
		),
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd,
		hasUI: options.hasUI ?? true,
		sessionManager: { getBranch: vi.fn(() => branch) },
		waitForIdle: vi.fn(async () => undefined),
		ui: {
			notify: vi.fn(),
			confirm: vi.fn(async () => options.confirm ?? true),
			editor: vi.fn(),
			setStatus: vi.fn(),
			setWidget: vi.fn(),
		},
	};
	return { pi, ctx, branch };
}

function latestGoalEntry(branch: Array<{ data?: unknown }>): GoalStateEntry {
	return branch.at(-1)?.data as GoalStateEntry;
}

const prd = `# Objective
Ship goal import from docs.

# Constraints
- Stay inside workspace.
- Keep briefs compact.

# Acceptance Criteria
- Reads markdown PRDs.
- Stores source paths.

# Risks
- Binary files could be misread.

# Open Questions
- What size limit is enough?

Referenced path: src/import.ts
`;

describe("goal import extraction", () => {
	it("extracts objective, constraints, acceptance criteria, risks, open questions, and source paths", () => {
		const extracted = extractGoalBrief(prd, "docs/prd.md");

		expect(extracted.objective).toBe("Ship goal import from docs.");
		expect(extracted.constraints).toEqual(["Stay inside workspace.", "Keep briefs compact."]);
		expect(extracted.acceptanceCriteria).toEqual(["Reads markdown PRDs.", "Stores source paths."]);
		expect(extracted.risks).toEqual(["Binary files could be misread."]);
		expect(extracted.openQuestions).toEqual(["What size limit is enough?"]);
		expect(extracted.sourcePaths).toContain("src/import.ts");
		expect(extracted.brief).toContain("Source: docs/prd.md");
	});

	it("imports a single markdown PRD file with compact source metadata", async () => {
		const cwd = await makeWorkspace();
		await mkdir(path.join(cwd, "docs"));
		await writeFile(path.join(cwd, "docs/prd.md"), prd);

		const result = await importGoalSources("docs/prd.md", { cwd });

		expect(result.objective).toBe("Ship goal import from docs.");
		expect(result.acceptanceCriteria).toHaveLength(2);
		expect(result.risks).toEqual(["Binary files could be misread."]);
		expect(result.openQuestions).toEqual(["What size limit is enough?"]);
		expect(result.sourceDocs[0]).toMatchObject({ path: "docs/prd.md", kind: "prd" });
		expect(result.sourceDocs[0]?.brief).toContain(
			"Acceptance criteria: Reads markdown PRDs.; Stores source paths.",
		);
	});

	it("imports docs folders, ignores generated/vendor content, and enforces file count limits", async () => {
		const cwd = await makeWorkspace();
		await mkdir(path.join(cwd, "docs/vendor"), { recursive: true });
		await mkdir(path.join(cwd, "docs/guides"), { recursive: true });
		await writeFile(path.join(cwd, "docs/prd.md"), prd);
		await writeFile(
			path.join(cwd, "docs/guides/notes.txt"),
			"# Acceptance Criteria\n- Folder note imported.",
		);
		await writeFile(path.join(cwd, "docs/vendor/ignored.md"), "# Objective\nDo not import vendor.");

		const result = await importGoalSources("docs", { cwd, maxFiles: 10 });

		expect(result.sourceDocs.map((doc) => doc.path).sort()).toEqual(["docs/guides/notes.txt", "docs/prd.md"]);
		expect(result.acceptanceCriteria).toContain("Folder note imported.");

		await expect(importGoalSources("docs", { cwd, maxFiles: 1 })).rejects.toThrow(
			"more than 1 supported docs files",
		);
	});

	it("rejects missing, unsafe, oversized, binary, and symlink escape inputs", async () => {
		const cwd = await makeWorkspace();
		const outside = await makeWorkspace();
		await mkdir(path.join(outside, "docs"));
		await writeFile(path.join(cwd, "big.md"), "x".repeat(20));
		await writeFile(path.join(cwd, "binary.md"), Buffer.from([0, 1, 2, 3]));
		await writeFile(path.join(outside, "outside.md"), prd);
		await writeFile(path.join(outside, "docs/outside.md"), prd);
		await symlink(path.join(outside, "outside.md"), path.join(cwd, "file-link.md"));
		await symlink(path.join(outside, "docs"), path.join(cwd, "dir-link"));

		await expect(importGoalSources("missing.md", { cwd })).rejects.toThrow("missing or unreadable");
		await expect(importGoalSources("../outside.md", { cwd })).rejects.toThrow("inside the current workspace");
		await expect(importGoalSources("file-link.md", { cwd })).rejects.toThrow("inside the current workspace");
		await expect(importGoalSources("dir-link", { cwd })).rejects.toThrow("inside the current workspace");
		await expect(importGoalSources("big.md", { cwd, maxFileBytes: 5 })).rejects.toThrow("too large");
		await expect(importGoalSources("binary.md", { cwd })).rejects.toThrow("binary");
	});
});

describe("/goal import command", () => {
	it("parses import path without confirmation flags", () => {
		expect(parseGoalCommand("import docs/prd.md --yes")).toMatchObject({
			kind: "import",
			path: "docs/prd.md",
			confirmed: true,
		});
	});

	it("asks confirmation then creates a goal from imported file", async () => {
		const cwd = await makeWorkspace();
		await mkdir(path.join(cwd, "docs"));
		await writeFile(path.join(cwd, "docs/prd.md"), prd);
		const { pi, ctx, branch } = createHarness(cwd, { confirm: true });

		await handleGoalCommand(pi, "import docs/prd.md", ctx);

		expect(ctx.waitForIdle).toHaveBeenCalledOnce();
		expect(ctx.ui.confirm).toHaveBeenCalledWith(
			"Create goal from import?",
			expect.stringContaining("Ship goal import"),
		);
		expect(latestGoalEntry(branch).action).toBe("create");
		expect(latestGoalEntry(branch).state).toMatchObject({
			objective: "Ship goal import from docs.",
			acceptanceCriteria: ["Reads markdown PRDs.", "Stores source paths."],
			sourceDocs: [expect.objectContaining({ path: "docs/prd.md" })],
		});
	});

	it("imports docs into an existing goal without rewriting objective", async () => {
		const cwd = await makeWorkspace();
		await writeFile(path.join(cwd, "notes.md"), prd);
		const { pi, ctx, branch } = createHarness(cwd, { confirm: true });
		await handleGoalCommand(pi, "Original objective", ctx);

		await handleGoalCommand(pi, "import notes.md", ctx);

		expect(ctx.ui.confirm).toHaveBeenLastCalledWith("Import docs into current goal?", expect.any(String));
		expect(latestGoalEntry(branch).action).toBe("import-docs");
		expect(latestGoalEntry(branch).state?.objective).toBe("Original objective");
		expect(latestGoalEntry(branch).state?.sourceDocs).toEqual([
			expect.objectContaining({ path: "notes.md" }),
		]);
	});

	it("rejects import into paused or complete goals without mutating state", async () => {
		const cwd = await makeWorkspace();
		await writeFile(path.join(cwd, "prd.md"), prd);

		const paused = createHarness(cwd, { confirm: true });
		await handleGoalCommand(paused.pi, "Paused objective", paused.ctx);
		await handleGoalCommand(paused.pi, "pause", paused.ctx);
		const pausedEntries = paused.branch.length;

		await handleGoalCommand(paused.pi, "import prd.md --yes", paused.ctx);

		expect(paused.branch).toHaveLength(pausedEntries);
		expect(latestGoalEntry(paused.branch).state?.status).toBe("paused");
		expect(paused.ctx.ui.notify).toHaveBeenLastCalledWith(
			expect.stringContaining("Cannot import docs into a paused goal"),
			"error",
		);

		const complete = createHarness(cwd, { confirm: true });
		await handleGoalCommand(complete.pi, "Complete objective", complete.ctx);
		await handleGoalCommand(complete.pi, "complete --yes", complete.ctx);
		const completeEntries = complete.branch.length;

		await handleGoalCommand(complete.pi, "import prd.md --yes", complete.ctx);

		expect(complete.branch).toHaveLength(completeEntries);
		expect(latestGoalEntry(complete.branch).state?.status).toBe("complete");
		expect(complete.ctx.ui.notify).toHaveBeenLastCalledWith(
			expect.stringContaining("Cannot import docs into a complete goal"),
			"error",
		);
	});

	it("requires --yes for import in no-UI mode after extraction", async () => {
		const cwd = await makeWorkspace();
		await writeFile(path.join(cwd, "prd.md"), prd);
		const { pi, ctx, branch } = createHarness(cwd, { hasUI: false });

		await handleGoalCommand(pi, "import prd.md", ctx);
		expect(branch).toHaveLength(0);
		expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("requires --yes"), "error");

		await handleGoalCommand(pi, "import prd.md --yes", ctx);
		expect(latestGoalEntry(branch).action).toBe("create");
	});
});
