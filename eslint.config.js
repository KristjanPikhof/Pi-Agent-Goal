import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		ignores: ["dist/**", "coverage/**", "node_modules/**"],
	},
	{
		files: ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
		},
		rules: {
			"@typescript-eslint/consistent-type-imports": "error",
		},
	},
);
