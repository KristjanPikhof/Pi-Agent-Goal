import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGoalCommand } from "./commands.js";

export { handleGoalCommand, parseGoalCommand, registerGoalCommand } from "./commands.js";
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

export default function goalExtension(pi: ExtensionAPI): void {
	registerGoalCommand(pi);
}
