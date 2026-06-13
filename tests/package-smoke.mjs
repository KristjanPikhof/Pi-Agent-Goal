#!/usr/bin/env node
/* global console, process */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
	maxBuffer: 1024 * 1024 * 8,
});
const [pack] = JSON.parse(stdout);
const files = new Set(pack.files.map((file) => file.path));
const requiredFiles = [
	"package.json",
	"extensions/index.ts",
	"extensions/pi-goal/index.ts",
	"src/index.ts",
	"src/runtime.ts",
	"src/tools.ts",
	"src/ui.ts",
	"src/state.ts",
	"src/import.ts",
	"docs/acceptance-criteria.md",
	"README.md",
	"LICENSE",
];
const missing = requiredFiles.filter((file) => !files.has(file));

if (pack.entryCount <= 0 || missing.length > 0) {
	console.error(`Package smoke failed. Missing: ${missing.join(", ") || "none"}`);
	process.exitCode = 1;
} else {
	console.log(`smoke:package ok: ${pack.filename} includes ${pack.entryCount} files`);
}
