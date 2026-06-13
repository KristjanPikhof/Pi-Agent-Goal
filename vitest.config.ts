import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		coverage: {
			reporter: ["text", "json-summary"],
			include: ["src/{runtime,tools,ui,state,import}.ts"],
			thresholds: {
				perFile: true,
				lines: 80,
				functions: 80,
				branches: 70,
				statements: 80,
			},
		},
	},
});
