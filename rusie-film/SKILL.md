---
name: rusie-film
description: Author single-player interactive films from MP4 clips with a local web editor, branching choices, and custom JavaScript or game-engine Web nodes. Connect provider-supplied runtimes, project and role data, validated results, playtesting, and export in Codex or Claude Code. Not animation production or multiplayer hosting.
---

# Interactive Film Solution Skill

Product name: 互动型影视解决方案 Skill.

Compose user-provided MP4 clips, custom logic, and game-engine Web packages into single-player interactive works. The local web editor and AI share `story.json`. Node.js 20+ is required; no npm installation or frontend build is needed. Users or node providers bundle runtimes such as Cocos with their components; the Skill does not include an engine.

In the commands below, `<skill>` is the directory containing this SKILL.md and `<project>` is the user's project directory. Use absolute paths with quoting appropriate to the current shell. Do not assume the working directory is the Skill directory.

## Canvas, control, and lifecycle

Before composing a work, read the [canvas lifecycle contract](references/canvas-lifecycle.md). The graph drives node entry, pre-video playback, dialogue, control waiting, validated completion, disposal, and transition. Plan these phases together with the background, video, portrait, and dialogue layers. Disposing a control does not clear the canvas. Controls can modify layers through the canvas API while graph definitions and the shared completion boundary remain fixed.

Retain a video's final frame during choices and while the next node loads, until the next video's first frame can be presented. Keep it when the next node has no new video. An explicit background directive cuts the old final frame on node entry, even if that node also has a pre-video. Do not automatically add backgrounds to continuous branches. Use the preceding clip's actual final frame as the first-frame reference when generating branch videos. Prepare and verify assets with the tools actually available; runtime frame retention does not automatically generate AI video.

## Authoring and editing

- Create a project: `node "<skill>/scripts/rusie.mjs" init --project "<project>" --title "Work title"`. This creates a blank work only when story.json does not exist. No narrative or sample media is included. Authors or AI supply content in the project, without modifying the installed Skill.
- Start the editor: `node "<skill>/scripts/rusie.mjs" serve --project "<project>"`. Give the user the complete local URL actually printed, including `#token=...`. Run the service as needed and stop it when finished. Ports are allocated automatically unless `--port` is supplied. Follow the host's background-process mechanism without opening extra terminal windows on Windows.
- Read a project: `node "<skill>/scripts/rusie.mjs" read --project "<project>"` returns story, revision, and issues. See the [project format](references/project-format.md) for structure and variable rules.
- Apply AI edits: generate a separate JSON file from the story just read, then run `node "<skill>/scripts/rusie.mjs" save --project "<project>" --from "<edited-file>" --revision "<read-revision>"`. Keep this file separate from story.json. Do not overwrite the authoritative file to bypass revision checks. On conflict, reread and merge without overwriting the user's newly saved work.
- Users can import MP4 files through the asset page; the tool copies and registers them. AI can also copy videos into the project's assets/ directory, then save registrations and node references through revision checks. Preserve original files. Asset paths must be project-relative, never absolute machine paths or references into the installation directory.
- Asset configuration covers MP4, HTML animation, character scripts, items, audio, backgrounds, portraits, and dialogue. Read the [asset catalog contract](references/asset-library.md) before using catalog entries. Update text with read → save. Import audio and images with `asset-import --kind audio|background|portrait|item --from <file> --revision <revision>` and the project option. HTML animation uses complete component packages. Catalog associations are authoring references; they do not automatically play audio, award items, or run dialogue. Do not describe registration as connected runtime behavior.
- When a scene needs a background, portrait, or dialogue, explicitly reference the catalog ID in presentation. Apply the background on entry, play the pre-video, show portraits/dialogue over its final frame, then show choices or mount the control. Omitting background inherits the canvas; explicit null clears background and the old final frame. Portrait and dialogue content is rebuilt per node by default. Keep effective scene content in the inspector and protocol/variable mapping in advanced settings. Reloading replays the node's dialogue without preserving a line cursor.

## Control nodes and data

The public extension type is `ControlNode`. Its `BaseNode` encapsulates connection, immutable definitions, lifecycle, and result submission. Read the [control-node interface](references/control-nodes.md), then inherit and implement or override choices, inputs, styles, history, inventory, and runtime events. Distribution includes interfaces and protocols, without a complete demo work. Providers implement custom JS/HTML, pure logic, or engines such as Cocos. Storage retains `type: custom`; see the [custom-node protocol](references/custom-nodes.md) for package structure and routing.

Store shared rules and level configuration in graph `data`, character definitions in `roles[id].data`, and changing progress in `variables` with declared initial values/types. Each custom node explicitly selects graph, current single-player role, and state fields through `custom.inputs`. Prefer these definitions over repeated hardcoding. Internal layout and other component implementation details can stay inside its package.

Providers deliver a complete Web build directory and `component.json`, declaring the runtime name, version, and required files. Read the revision, then run `node "<skill>/scripts/rusie.mjs" component-import --project "<project>" --from "<provider-package>" --revision "<read-revision>"`. This copies listed files, checks dependencies, registers the component, and upgrades the project to `rusie.film/2`. Do not install the full Creator toolchain or silently fetch missing runtimes. After registration, story.components is authoritative; keep versions and declarations aligned when updating packages, and avoid modifying executing files.

Use `RusieNode.connect()` to receive declared inputs and `complete(outcome, result)` to return results. The host validates exits, result types, and bounds, then applies declared capture/set assignments and transitions. Components cannot submit arbitrary target nodes, rewrite graph definitions, or obtain editor tokens. Optional checkpoints preserve internal JSON progress. Components must handle pause/resume/dispose messages.

An internal button can also call `complete(output)` to finish its own node. Current outgoing edges read that result with `when: {source: 'lastNode.output', field: 'fieldName', equals: value}`. Exactly one edge must match. This cannot finish another node and accepts no executable expressions. Rebuild lastNode from validated history rather than trusting its persisted copy. See the protocol for details.

Graph/role definitions, components, and custom nodes require `rusie.film/2`; legacy pure-film `rusie.film/1` remains readable. Explicitly upgrade format when adding these fields by hand.

Index media using author descriptions, existing subtitles, or video viewing/frame extraction tools actually available in the environment. Say when footage has not been viewed; do not invent content from filenames or require the entire video as model input. Preserve creative freedom without fixing a genre, shot count, or story structure.

## Validation and delivery

`node "<skill>/scripts/rusie.mjs" validate --project "<project>"` checks structure, references, variable types, path reachability, and media files. Fix errors; interpret warnings against story intent. Static reachability does not prove that every variable combination can reach an ending.

Playtest from the start and through important branches in the editor, checking actual videos, choices, conditions, and endings. Report browser validation that has not been performed. Accepted MP4 containers do not guarantee that every browser can decode the video codec.

Export with `node "<skill>/scripts/rusie.mjs" export --project "<project>" --out "<new-output-directory>" --revision "<latest-revision>"`; the output directory must not exist. Pure-film works can open index.html directly. For custom nodes, use the bundled Windows launcher `启动作品.cmd` (Node.js 20+) or `node serve.mjs --open`, or configure component-resource CORS on a static site as described by the launch instructions. Playing an exported work requires neither the Skill nor a model service. It can run offline when all data and runtime files are bundled locally.

Local launchers assign a stable port from the project ID to preserve browser saves. On conflict, stop the old instance or explicitly use `node serve.mjs --port <port> --open`. Changing the port changes the browser storage origin. If storage is blocked, play continues for the current session. Custom-node internal progress is saved only through explicit checkpoints.

## Boundaries

Current support covers branching after videos, simple variables and equality conditions, endings, saves at node boundaries, custom Web/logic nodes, and validated result return. It does not produce Canvas animations or implement multiplayer synchronization or role authorization.

`extensions` reserves metadata only. Current role projections define the component bridge's data boundary, not multiplayer authorization. Local users can inspect offline source files. iframe isolation does not impose hard CPU/memory quotas on malicious code or guarantee complete network isolation. Do not describe imported unknown code or model generation as having passed a security audit. Future multiplayer adapters require separate identity, visibility, and authoritative-result verification.
