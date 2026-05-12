import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGoalCommand } from "./commands.js";
import { registerGoalTools } from "./tools.js";
import { registerGoalRuntime } from "./runtime.js";

export { handleGoalCommand, parseGoalCommand, registerGoalCommand, startActiveGoal } from "./commands.js";
export {
	createGoalCompaction,
	createGoalContextMessage,
	createGoalContinuationState,
	DEFAULT_GOAL_CONTINUATION_MAX_TURNS,
	filterGoalContextMessages,
	finishRunningGoalContinuation,
	GOAL_CONTINUATION_CUSTOM_TYPE,
	maybeQueueGoalContinuation,
	registerGoalRuntime,
	startQueuedGoalContinuation,
	stopGoalContinuation,
} from "./runtime.js";
export {
	compactGoalDetails,
	escapeXml,
	GOAL_CONTEXT_CUSTOM_TYPE,
	renderCompactGoalSummary,
	renderContinuationPrompt,
	renderGoalContext,
	renderGoalStartPrompt,
} from "./prompts.js";
export {
	DEFAULT_IMPORT_MAX_FILE_BYTES,
	DEFAULT_IMPORT_MAX_FILES,
	extractGoalBrief,
	GoalImportError,
	importGoalSources,
	resolveImportPath,
} from "./import.js";
export {
	completeGoalParams,
	createGoalParams,
	executeCompleteGoal,
	executeCreateGoal,
	executeGetGoal,
	executeUpdateGoalProgress,
	formatGoalToolCall,
	formatGoalToolResult,
	getGoalParams,
	registerGoalTools,
	updateGoalProgressParams,
} from "./tools.js";
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
	registerGoalTools(pi);
	registerGoalRuntime(pi);
}
