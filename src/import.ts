import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { GoalSourceDoc } from "./types.js";

export const DEFAULT_IMPORT_MAX_FILE_BYTES = 256 * 1024;
export const DEFAULT_IMPORT_MAX_FILES = 25;

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const IGNORED_DIR_NAMES = new Set([
	".git",
	".trekoon",
	"node_modules",
	"dist",
	"build",
	"coverage",
	".next",
	".turbo",
	"vendor",
]);

export interface GoalImportOptions {
	cwd: string;
	maxFileBytes?: number;
	maxFiles?: number;
}

export interface GoalImportResult {
	objective: string;
	constraints: string[];
	acceptanceCriteria: string[];
	risks: string[];
	openQuestions: string[];
	sourcePaths: string[];
	sourceDocs: GoalSourceDoc[];
}

interface ExtractedDoc {
	objective?: string;
	constraints: string[];
	acceptanceCriteria: string[];
	risks: string[];
	openQuestions: string[];
	sourcePaths: string[];
	brief: string;
}

export class GoalImportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GoalImportError";
	}
}

export async function importGoalSources(inputPath: string, options: GoalImportOptions): Promise<GoalImportResult> {
	const resolved = resolveImportPath(inputPath, options.cwd);
	const entryStat = await statImportPath(resolved);
	const maxFileBytes = options.maxFileBytes ?? DEFAULT_IMPORT_MAX_FILE_BYTES;
	const maxFiles = options.maxFiles ?? DEFAULT_IMPORT_MAX_FILES;

	if (entryStat.isDirectory()) {
		const files = await collectDocsFiles(resolved, { cwd: options.cwd, maxFiles });
		if (files.length === 0) throw new GoalImportError(`No supported docs files found in: ${inputPath}`);
		const results = await Promise.all(files.map((file) => importOneFile(file, options.cwd, maxFileBytes)));
		return combineImports(results, `Imported docs from ${path.relative(options.cwd, resolved) || "."}`);
	}

	if (!entryStat.isFile()) throw new GoalImportError(`Import path is not a file or directory: ${inputPath}`);
	return combineImports([await importOneFile(resolved, options.cwd, maxFileBytes)], "Imported goal source document");
}

export function extractGoalBrief(content: string, sourcePath: string): ExtractedDoc {
	const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const sections = parseMarkdownSections(normalized);
	const objective = firstValue(sections, ["objective", "goal", "problem", "problem statement", "summary"]);
	const constraints = listValues(sections, ["constraints", "non-goals", "non goals"]);
	const acceptanceCriteria = listValues(sections, ["acceptance criteria", "acceptance", "definition of done", "success criteria"]);
	const risks = listValues(sections, ["risks", "risk", "mitigations"]);
	const openQuestions = listValues(sections, ["open questions", "questions"]);
	const sourcePaths = extractSourcePaths(normalized);
	const brief = renderBrief({ sourcePath, objective, constraints, acceptanceCriteria, risks, openQuestions, sourcePaths });

	return { objective, constraints, acceptanceCriteria, risks, openQuestions, sourcePaths, brief };
}

export function resolveImportPath(inputPath: string, cwd: string): string {
	const trimmed = inputPath.trim();
	if (!trimmed) throw new GoalImportError("Usage: /goal import <file-or-directory>");
	if (trimmed.includes("\0")) throw new GoalImportError("Import path contains invalid characters.");

	const resolved = path.resolve(cwd, trimmed);
	const relative = path.relative(cwd, resolved);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new GoalImportError("Import path must stay inside the current workspace.");
	}
	return resolved;
}

async function statImportPath(resolved: string) {
	try {
		return await stat(resolved);
	} catch (error) {
		throw new GoalImportError(`Import path is missing or unreadable: ${resolved}`);
	}
}

async function importOneFile(resolved: string, cwd: string, maxFileBytes: number): Promise<GoalImportResult> {
	if (!isSupportedTextPath(resolved)) throw new GoalImportError(`Unsupported file type: ${path.relative(cwd, resolved)}`);
	const fileStat = await statImportPath(resolved);
	if (!fileStat.isFile()) throw new GoalImportError(`Import path is not a file: ${path.relative(cwd, resolved)}`);
	if (fileStat.size > maxFileBytes) {
		throw new GoalImportError(`Import file is too large (${fileStat.size} bytes): ${path.relative(cwd, resolved)}`);
	}

	let buffer: Buffer;
	try {
		buffer = await readFile(resolved);
	} catch {
		throw new GoalImportError(`Import file is unreadable: ${path.relative(cwd, resolved)}`);
	}
	if (isBinary(buffer)) throw new GoalImportError(`Import file appears to be binary: ${path.relative(cwd, resolved)}`);

	const relativePath = path.relative(cwd, resolved).replace(/\\/g, "/");
	const content = buffer.toString("utf8");
	const extracted = extractGoalBrief(content, relativePath);
	const sourceDoc: GoalSourceDoc = {
		path: relativePath,
		kind: inferDocKind(relativePath),
		brief: extracted.brief,
		hash: createHash("sha256").update(buffer).digest("hex"),
		extractedAt: Date.now(),
	};

	return {
		objective: extracted.objective ?? `Use ${relativePath} as the goal source`,
		constraints: extracted.constraints,
		acceptanceCriteria: extracted.acceptanceCriteria,
		risks: extracted.risks,
		openQuestions: extracted.openQuestions,
		sourcePaths: unique([relativePath, ...extracted.sourcePaths]),
		sourceDocs: [sourceDoc],
	};
}

async function collectDocsFiles(dir: string, options: { cwd: string; maxFiles: number }): Promise<string[]> {
	const found: string[] = [];

	async function visit(current: string): Promise<void> {
		if (found.length >= options.maxFiles) return;
		const entries = await readdir(current, { withFileTypes: true });
		for (const entry of entries) {
			if (found.length >= options.maxFiles) return;
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				if (IGNORED_DIR_NAMES.has(entry.name)) continue;
				await visit(fullPath);
			} else if (entry.isFile() && isSupportedTextPath(fullPath)) {
				found.push(fullPath);
			}
		}
	}

	await visit(dir);
	return found.sort();
}

function combineImports(results: GoalImportResult[], fallbackObjective: string): GoalImportResult {
	return {
		objective: results.find((result) => result.objective.trim())?.objective ?? fallbackObjective,
		constraints: unique(results.flatMap((result) => result.constraints)),
		acceptanceCriteria: unique(results.flatMap((result) => result.acceptanceCriteria)),
		risks: unique(results.flatMap((result) => result.risks)),
		openQuestions: unique(results.flatMap((result) => result.openQuestions)),
		sourcePaths: unique(results.flatMap((result) => result.sourcePaths)),
		sourceDocs: results.flatMap((result) => result.sourceDocs),
	};
}

function parseMarkdownSections(content: string): Map<string, string[]> {
	const sections = new Map<string, string[]>();
	let current = "summary";
	sections.set(current, []);

	for (const line of content.split("\n")) {
		const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
		if (heading) {
			current = normalizeHeading(heading[1] ?? "");
			sections.set(current, sections.get(current) ?? []);
			continue;
		}
		sections.get(current)?.push(line);
	}

	return sections;
}

function firstValue(sections: Map<string, string[]>, keys: string[]): string | undefined {
	for (const key of keys) {
		const lines = sections.get(key);
		const value = linesToParagraph(lines);
		if (value) return value;
	}
	return undefined;
}

function listValues(sections: Map<string, string[]>, keys: string[]): string[] {
	return unique(keys.flatMap((key) => extractListItems(sections.get(key) ?? [])));
}

function linesToParagraph(lines: string[] | undefined): string | undefined {
	const text = (lines ?? [])
		.map((line) => line.replace(/^[-*+]\s+/, "").trim())
		.filter(Boolean)
		.join(" ")
		.trim();
	return text.length > 0 ? truncate(text, 500) : undefined;
}

function extractListItems(lines: string[]): string[] {
	const items = lines
		.map((line) => {
			const match = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
			return match?.[1]?.trim();
		})
		.filter((item): item is string => Boolean(item));
	return items.length > 0 ? items.map((item) => truncate(item, 300)) : linesToParagraph(lines)?.split(/;\s*/) ?? [];
}

function extractSourcePaths(content: string): string[] {
	const matches = content.match(/(?:[\w.-]+\/)+[\w.-]+\.[\w]+/g) ?? [];
	return unique(matches.map((value) => value.replace(/[),.;:]+$/, "")));
}

function renderBrief(input: {
	sourcePath: string;
	objective?: string;
	constraints: string[];
	acceptanceCriteria: string[];
	risks: string[];
	openQuestions: string[];
	sourcePaths: string[];
}): string {
	return [
		`Source: ${input.sourcePath}`,
		`Objective: ${input.objective ?? "not specified"}`,
		formatBriefList("Constraints", input.constraints),
		formatBriefList("Acceptance criteria", input.acceptanceCriteria),
		formatBriefList("Risks", input.risks),
		formatBriefList("Open questions", input.openQuestions),
		formatBriefList("Referenced paths", input.sourcePaths),
	]
		.filter(Boolean)
		.join("\n");
}

function formatBriefList(label: string, values: string[]): string {
	return values.length === 0 ? `${label}: none` : `${label}: ${values.slice(0, 8).join("; ")}`;
}

function normalizeHeading(value: string): string {
	return value.trim().toLowerCase().replace(/:$/, "");
}

function isSupportedTextPath(filePath: string): boolean {
	return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isBinary(buffer: Buffer): boolean {
	if (buffer.includes(0)) return true;
	const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
	let suspicious = 0;
	for (const byte of sample) {
		if (byte < 7 || (byte > 14 && byte < 32)) suspicious++;
	}
	return sample.length > 0 && suspicious / sample.length > 0.1;
}

function inferDocKind(relativePath: string): GoalSourceDoc["kind"] {
	return /prd|requirements?/i.test(relativePath) ? "prd" : "doc";
}

function truncate(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function unique(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
