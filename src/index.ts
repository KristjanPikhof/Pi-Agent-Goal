import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGoalCommand } from "./commands.js";
import { registerGoalTools } from "./tools.js";
import { registerGoalRuntime } from "./runtime.js";

export {
	confirmGoalReplacement,
	handleGoalCommand,
	offerGoalStartHandoff,
	parseGoalCommand,
	registerGoalCommand,
	reviewGoalProposal,
	saveReviewedGoalAndOfferStart,
	startActiveGoal,
} from "./commands.js";
export type {
	GoalProposalReviewResult,
	GoalStartAPI,
	GoalWorkflowContext,
	ParsedGoalCommand,
	SaveReviewedGoalOptions,
} from "./commands.js";
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
	renderGoalAgentDraftingPrompt,
	renderGoalContext,
	renderGoalStartPrompt,
} from "./prompts.js";
export { preparePlainGoalDraft } from "./goal-prep.js";
export type { GoalDraftProposal, GoalProposalGenerator, PreparedGoalDraft } from "./goal-prep.js";
export {
	DEFAULT_IMPORT_MAX_FILE_BYTES,
	DEFAULT_IMPORT_MAX_FILES,
	extractGoalBrief,
	GoalImportError,
	importGoalSources,
	parseEditableGoalDraft,
	renderEditableGoalDraft,
	resolveImportPath,
} from "./import.js";
export {
	completeGoalParams,
	createGoalParams,
	executeCompleteGoal,
	executeCreateGoal,
	executeGetGoal,
	executeProposeGoalDraft,
	executeUpdateGoalProgress,
	formatGoalToolCall,
	formatGoalToolResult,
	getGoalParams,
	proposeGoalDraftParams,
	proposeGoalDraftPromptGuidelines,
	proposeGoalDraftPromptSnippet,
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
