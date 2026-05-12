# Pi `/goal` extension implementation docs

This folder captures the implementation plan for a Pi extension that brings Codex-style `/goal` behavior to Pi.

Read in this order:

1. [`implementation.md`](implementation.md), architecture, state model, commands, tools, compaction, continuation, UI, and phases.
2. [`acceptance-criteria.md`](acceptance-criteria.md), test matrix and done criteria.

## TL;DR

Implement `/goal` as a Pi extension with canonical state stored in Pi custom session entries. The extension should inject short hidden goal context before relevant turns, preserve a compact goal summary during compaction, expose model tools for goal read/create/complete, and continue active goals safely only when Pi is idle.

The Codex implementation uses a SQLite `thread_goals` table and app-server events. Pi should not copy that persistence model. Pi already has branch-aware session entries, custom messages, commands, tools, and compaction hooks. Use those primitives instead.

## Primary source references

### Codex source paths

- `/Users/kristjan.pikhof/Desktop/Development/codex/codex-rs/tui/src/slash_command.rs`
- `/Users/kristjan.pikhof/Desktop/Development/codex/codex-rs/tui/src/chatwidget/slash_dispatch.rs`
- `/Users/kristjan.pikhof/Desktop/Development/codex/codex-rs/tui/src/app/thread_goal_actions.rs`
- `/Users/kristjan.pikhof/Desktop/Development/codex/codex-rs/app-server/src/request_processors/thread_goal_processor.rs`
- `/Users/kristjan.pikhof/Desktop/Development/codex/codex-rs/core/src/goals.rs`
- `/Users/kristjan.pikhof/Desktop/Development/codex/codex-rs/core/src/tools/handlers/goal_spec.rs`
- `/Users/kristjan.pikhof/Desktop/Development/codex/codex-rs/state/src/runtime/goals.rs`
- `/Users/kristjan.pikhof/Desktop/Development/codex/codex-rs/state/migrations/0029_thread_goals.sql`
- `/Users/kristjan.pikhof/Desktop/Development/codex/codex-rs/core/src/compact.rs`
- `/Users/kristjan.pikhof/Desktop/Development/codex/codex-rs/core/src/session/turn.rs`

### Pi documentation and examples

- `/Users/kristjan.pikhof/.nvm/versions/node/v24.12.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `/Users/kristjan.pikhof/.nvm/versions/node/v24.12.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md`
- `/Users/kristjan.pikhof/.nvm/versions/node/v24.12.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/compaction.md`
- `/Users/kristjan.pikhof/.nvm/versions/node/v24.12.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
- `/Users/kristjan.pikhof/.nvm/versions/node/v24.12.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/todo.ts`
- `/Users/kristjan.pikhof/.nvm/versions/node/v24.12.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/plan-mode/index.ts`
