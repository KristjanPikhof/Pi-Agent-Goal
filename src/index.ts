import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export {
	createGoalState,
	createGoalStateSnapshot,
	getCurrentGoal,
	GOAL_CUSTOM_TYPE,
	GoalStateValidationError,
	loadGoalState,
	MAX_OBJECTIVE_LENGTH,
	reduceGoalState,
	saveGoalState,
	toGoalStateEntry,
	validateObjective,
} from "./state.js";
export type {
	GoalOwner,
	GoalProgress,
	GoalSourceDoc,
	GoalState,
	GoalStateAction,
	GoalStateEntry,
	GoalStateEvent,
	GoalStateSnapshot,
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
