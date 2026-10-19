# Engineering guidelines

Product: 互动型影视解决方案 Skill. Repository: `interactive-film-skill`.
The installable skill and existing project identifiers remain `rusie-film` and `rusie.film/2`.

## Start here

- Read `docs/architecture.md` before changing module boundaries or data flow.
- Read `docs/development.md` for commands and validation.
- Current code is in `rusie-film/`. Public extensions inherit BaseNode / ControlNode; examples are not part of the repository or runtime package.
- Earlier projects and local working copies are described in `docs/workspace-boundaries.md`. Preserve their files, nested repositories and unrelated changes.

## Implementation

Prioritize correct architecture, simple code, reliable execution, reasonable resource use, observable behavior and verifiable results.

Check responsibility boundaries, dependencies, race conditions, idempotency, consistency, CPU/memory/IO, traceability and failure cases. Raise architecture conflicts before implementing an obviously flawed design. For unresolved high-impact choices, explain the context, options and impact and ask for a decision.

Reuse shared story validation across editor, CLI and player. Preserve revision checks and write locks. Custom nodes read only declared data and complete only their current visit; catalog associations alone do not execute actions. Component providers supply their complete runtime dependencies.

Use the canvas + control architecture. The graph owns overall lifecycle; background, video, portrait and dialogue have separate visual lifetimes. Disposing a control must not implicitly destroy the persistent canvas. Preserve a video tail across choices and transitions until the next first frame; an explicit background directive cuts it on entry, including before another pre-video. Read `rusie-film/references/canvas-lifecycle.md` before changing these rules.

Run checks appropriate to the change. Browser checks use temporary project copies; do not modify maintained examples with test state. Verify resolved target boundaries before recursive deletion or moving files. Keep generated output out of source packages and Git.

For important changes, include an Engineering Review covering:

Architecture, Code, Concurrency, Resource, Audit, Verification, Risks, Decisions Needed.
