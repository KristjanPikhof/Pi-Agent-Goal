import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type {
	GoalProgress,
	GoalSourceDoc,
	GoalState,
	GoalStateAction,
	GoalStateEntry,
	GoalStatus,
} from "./types.js";

const PLACEHOLDER_MESSAGE = [
	"/goal extension scaffold loaded.",
	"Goal behavior is intentionally not implemented yet.",
	"See docs/implementation.md for the planned phases.",
].join("\n");

export default function goalExtension(pi: ExtensionAPI): void {
	pi.registerCommand("goal", {
		description: "Placeholder for long-running goal management",
		handler: async (_args, ctx) => {
			ctx.ui.notify(PLACEHOLDER_MESSAGE, "info");
		},
	});
}
