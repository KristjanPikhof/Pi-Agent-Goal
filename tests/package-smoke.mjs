#!/usr/bin/env node
/* global AbortSignal, console, process */
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmpRoot = await mkdtemp(join(tmpdir(), "pi-goal-package-smoke-"));
const packDir = join(tmpRoot, "pack");
const installDir = join(tmpRoot, "install");
const timeoutMs = Number(process.env.PI_GOAL_PACKAGE_SMOKE_TIMEOUT_MS ?? 120_000);
const piVersion = process.env.PI_GOAL_PACKAGE_SMOKE_PI_VERSION ?? "0.80.7";
const piTuiVersion = process.env.PI_GOAL_PACKAGE_SMOKE_PI_TUI_VERSION ?? "0.80.7";

try {
	await runPackageSmoke();
} finally {
	await rm(tmpRoot, { recursive: true, force: true });
}

async function runPackageSmoke() {
	await mkdir(packDir, { recursive: true });
	await mkdir(installDir, { recursive: true });

	const { stdout } = await execFileAsync("npm", ["pack", "--pack-destination", packDir, "--json"], {
		cwd: repoRoot,
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
		"docs/README.md",
		"docs/setup.md",
		"docs/implementation.md",
		"docs/acceptance-criteria.md",
		"README.md",
		"LICENSE",
	];
	const missing = requiredFiles.filter((file) => !files.has(file));

	if (pack.entryCount <= 0 || missing.length > 0) {
		throw new Error(`Package smoke failed. Missing: ${missing.join(", ") || "none"}`);
	}

	const tarballPath = join(packDir, pack.filename);
	await writeFile(join(installDir, "package.json"), JSON.stringify({ private: true, type: "module" }));
	await execFileAsync(
		"npm",
		[
			"install",
			"--ignore-scripts",
			tarballPath,
			`@earendil-works/pi-coding-agent@${piVersion}`,
			`@earendil-works/pi-tui@${piTuiVersion}`,
			"typebox",
		],
		{ cwd: installDir, maxBuffer: 1024 * 1024 * 8, timeout: timeoutMs },
	);

	const installedPackageJsonPath = join(installDir, "node_modules", "pi-agent-goal", "package.json");
	const installedPackageJson = JSON.parse(await readFile(installedPackageJsonPath, "utf8"));
	const entry = installedPackageJson.exports?.["."] ?? installedPackageJson.main;
	if (entry !== "./extensions/index.ts") {
		throw new Error(`Package smoke failed. Unexpected package entry: ${entry}`);
	}

	const installedPiBin = join(
		installDir,
		"node_modules",
		".bin",
		process.platform === "win32" ? "pi.cmd" : "pi",
	);
	const installedEntry = `./${join("node_modules", "pi-agent-goal", entry)}`;
	const smoke = await run(
		installedPiBin,
		["--no-session", "--no-extensions", "-e", installedEntry, "-p", "/goal"],
		{
			cwd: installDir,
			env: {
				...process.env,
				PI_OFFLINE: "1",
				PI_CODING_AGENT_DIR: join(tmpRoot, "agent"),
				PI_CODING_AGENT_SESSION_DIR: join(tmpRoot, "sessions"),
			},
			timeoutMs,
		},
	);
	const smokeOutput = smoke.output.trim();
	if (
		smoke.code !== 0 ||
		/(?:failed to load extension|unknown command|command exited with code|\berror\b)/i.test(smokeOutput)
	) {
		throw new Error(smokeOutput || `Installed package smoke exited with ${smoke.code ?? "unknown"}`);
	}

	console.log(
		`smoke:package ok: ${pack.filename} includes ${pack.entryCount} files and installed entry ${entry} loads with pi ${piVersion} / pi-tui ${piTuiVersion}`,
	);
}

function run(command, args, options) {
	return new Promise((resolveRun, reject) => {
		const signal = AbortSignal.timeout(options.timeoutMs);
		let output = "";
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
			signal,
		});
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		child.stderr.on("data", (chunk) => {
			output += chunk;
		});
		child.on("error", (error) => {
			if (error.name === "AbortError") {
				reject(
					new Error(`Smoke command timed out after ${options.timeoutMs}ms: ${command} ${args.join(" ")}`),
				);
				return;
			}
			reject(error);
		});
		child.on("close", (code) => resolveRun({ code, output }));
	});
}
