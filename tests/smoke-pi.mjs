#!/usr/bin/env node
/* global AbortSignal, console, process */
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const piBin = join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "pi.cmd" : "pi");
const mode = process.argv[2] ?? "goal";
const timeoutMs = Number(process.env.PI_GOAL_SMOKE_TIMEOUT_MS ?? 30_000);
const tmpRoot = await mkdir(join(tmpdir(), `pi-goal-smoke-${process.pid}-${mode}`), { recursive: true });

const commands = {
	goal: ["--no-session", "--no-extensions", "-e", "./extensions/index.ts", "-p", "/goal"],
	continuation: [
		"--no-session",
		"--no-extensions",
		"-e",
		"./extensions/index.ts",
		"--goal-continuation",
		"-p",
		"/goal",
	],
};

if (!(mode in commands)) {
	console.error(`Unknown smoke mode: ${mode}`);
	process.exitCode = 2;
} else {
	try {
		const result = await run(piBin, commands[mode], {
			cwd: repoRoot,
			env: {
				...process.env,
				PI_OFFLINE: "1",
				PI_CODING_AGENT_DIR: join(tmpRoot, "agent"),
				PI_CODING_AGENT_SESSION_DIR: join(tmpRoot, "sessions"),
			},
			timeoutMs,
		});
		if (result.code !== 0) {
			console.error(result.output.trim());
			process.exitCode = result.code ?? 1;
		} else {
			console.log(`smoke:${mode} ok: pi ${commands[mode].join(" ")}`);
		}
	} finally {
		await rm(tmpRoot, { recursive: true, force: true });
	}
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
