# Interactive Film Solution Skill

An extensible interactive film skill for Codex and Claude Code, with a local editor and inheritable control nodes for custom assets, events, and UI.

Repository: `interactive-film-skill`. Skill identifier: `rusie-film`. Product name: 互动型影视解决方案 Skill. The public extension type is **ControlNode**. **BaseNode** encapsulates the immutable base definition, inputs, lifecycle, and result submission. Inherit these classes to implement choices, inputs, styles, history, inventory, asset loading, and runtime events. Providers define their own gameplay.

## Installation

Copy the complete `rusie-film` directory, including its supporting files:

| Tool | Project-level directory | User-level directory |
| --- | --- | --- |
| Codex | `<workspace>/.agents/skills/rusie-film/` | `~/.agents/skills/rusie-film/` |
| Claude Code | `<workspace>/.claude/skills/rusie-film/` | `~/.claude/skills/rusie-film/` |

Both tools use the same content. Keep authored projects outside the installation directory. Distribution excludes complete examples and test fixtures.

## Create, edit, and export

Run these commands from the installed Skill directory, or use the absolute path to scripts/rusie.mjs:

```sh
node scripts/rusie.mjs init --project /path/to/my-film --title "My work"
node scripts/rusie.mjs serve --project /path/to/my-film
node scripts/rusie.mjs read --project /path/to/my-film
node scripts/rusie.mjs validate --project /path/to/my-film
node scripts/rusie.mjs export --project /path/to/my-film --out /path/to/new-export
```

Initialization creates a blank work. Authors or AI supply the story, assets, and node implementations. Node.js 20+ is required, with no npm dependencies to install. Follow the read → save revision checks in [SKILL.md](SKILL.md) for AI edits; do not overwrite story.json directly to bypass them.

Pure-film works can open the exported index.html directly. Works with control nodes run over HTTP through the bundled launcher or a static site. The provider's complete runtime and resources are included in the export. Playback requires neither the Skill nor a model service.

## AI interface

Start with the [control-node interface](references/control-nodes.md). The implementation is `assets/shared/control-node.js`, with type declarations in `assets/shared/control-node.d.ts`. Override `renderChoices`, `renderInputs`, `applyStyles`, `renderHistory`, `renderInventory`, `onEvent`, and lifecycle methods on `ControlNode`. Extend `BaseNode` for a fully custom view.

Base definitions and inputs are immutable; extensions own their event and view implementations. Buttons call `complete(output)` to finish the current node, whose outgoing edges read `lastNode.output` through shared validation. Custom asset types are not limited to common catalog categories. Declare required files and runtime dependencies in the component manifest.

See the [component protocol](references/custom-nodes.md), [project format](references/project-format.md), and [asset catalog](references/asset-library.md) for details. Multiplayer authorization/synchronization, animation production, and engine installation are outside the current scope. View overrides remain inside isolated components without editor privileges. Isolation does not impose hard resource quotas on malicious code.

## Canvas and flow

The [canvas + control architecture](references/canvas-lifecycle.md) separates overall graph lifecycle from the persistent background, video, portrait, and dialogue layers. Controls modify these layers through `this.canvas.set()` / `clear()`.

Retain a pre-video's final frame during choices and cross-node loading until the next video's first frame is ready. An explicit background directive cuts the old frame on node entry, even if that node also has a pre-video. AI must plan flow around these rules and use actual final frames when producing continuous branches, without automatically adding backgrounds to every branch.
