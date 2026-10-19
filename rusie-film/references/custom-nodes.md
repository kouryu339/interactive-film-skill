# Custom-node protocol v1

The public extension class is `ControlNode`, with fixed base class `BaseNode`. See the [control-node interface](control-nodes.md) for inheritance and overrides. This document describes the compatible underlying protocol. `custom` is a storage field, not another public extension type.

Use it for JS logic, HTML interaction, or game-engine Web builds. Providers write execution logic; the interpreter manages input projection, lifecycle, state commits, and result routing. New project fields use `rusie.film/2`; the player also accepts legacy pure-film `/1`.

## Work data and read declarations

```json
{
  "format": "rusie.film/2",
  "data": { "puzzle": { "code": "2410" }, "authorNotes": "Not exposed" },
  "roles": { "detective": { "name": "Detective", "data": { "observation": 3, "privateMemo": "Not exposed" } } },
  "playerRole": "detective",
  "variables": { "score": 0 }
}
```

This fragment omits required id/title/start/assets/nodes. Store shared settings in data, role configuration in roles[id].data, and changing progress in variables. Role definitions currently contain name and data only; they do not implement authentication or multiplayer bindings. Single-player playerRole determines the role-input source.

A custom-node declaration, including the ordinary title/text/video/ending fields:

```json
{
  "id": "lock",
  "title": "Open the signal console",
  "text": "Investigate the message left behind.",
  "video": null,
  "ending": false,
  "type": "custom",
  "custom": {
    "component": "signal-lock",
    "mode": "web",
    "inputs": { "graph": ["puzzle"], "role": ["observation"], "state": ["score"] },
    "config": { "theme": "harbor" },
    "result": { "score": { "type": "number", "min": 0, "max": 100 } },
    "startTimeoutMs": 30000,
    "timeoutMs": 1800000
  },
  "choices": [{ "id": "solved", "label": "Success", "target": "ending", "capture": { "score": "score" } }]
}
```

Explicitly provide all three inputs field lists; an empty list reads nothing. References select top-level keys only, without interpreting expressions, path strings, or JS. Values may be nested JSON. Pass only selected data for the current role, not the whole graph, other roles, all variables, project directories, or host tokens. Inputs are deep-copied and recursively frozen. Freezing prevents accidental edits; changes to a component's copy cannot mutate the host.

`mode: web` shows a page. `mode: logic` uses the same isolated bridge without a visible interaction page. Custom execution may start after the node's video ends. Custom nodes cannot be endings; route their results to an ending node.

Result fields support number/string/boolean/json. Every declared field is required; extra fields are rejected. Numbers support min/max; strings support maxLength. capture maps session-variable keys to result-field names with matching types. An exit cannot both capture and set the same variable. choices.id defines allowed outcomes; target comes from the definition. Internal computation is unrestricted, but the host accepts only declared output.

## Internal buttons, node completion, and output edges

A component's own button may call `await node.complete({ route: 'radio', score: 80 })`. This submits completion for the current node once, with all output fields still satisfying custom.result. The component does not submit a target node ID. The interpreter evaluates current outgoing edges against this submission's candidate `lastNode.output`, for example:

```json
{ "id": "broadcast", "label": "Go to the radio room", "target": "radio", "when": { "source": "lastNode.output", "field": "route", "equals": "radio" } }
```

field must name a top-level scalar declared in the current node's result, and equals must have the same type. No JS, string paths, expressions, or references to other nodes are interpreted. complete(output) must match exactly one edge. Zero or multiple matches reject the whole operation without changing current state. Success commits output, variable assignments, and transition together. Paused, stale-visit, and duplicate submissions remain rejected.

Session snapshot.lastNode is `{ id, output }` for the most recently completed node. Ordinary nodes produce null output; before any completion, lastNode is null. Edge checks use the current submission's candidate output, never leftovers from a save or previous visit. Restore reconstructs lastNode from validated history rather than trusting that field in the save.

Existing `complete(outcome, result)` remains compatible. Direct session calls can use `finish(output, expectedVisit)` to validate automatic routing. Components use public SDK complete(output) without accessing the host session.

## Provider package

```text
my-web-build/
  component.json
  index.html
  game.js
  runtime.js
  assets/...
```

```json
{
  "id": "signal-lock",
  "label": "Signal console minigame",
  "entry": "index.html",
  "files": ["index.html", "game.js", "runtime.js"],
  "runtime": { "name": "my-web-engine", "version": "1.0.0", "files": ["runtime.js"] }
}
```

files must list every required file: entry, engine, scripts, styles, WASM, and resources. runtime.files names the required runtime files among them and must contain at least one entry. Even a plain-JS node declares its execution script. Providers specify the actual runtime name/version; tools do not guess them.

Manifests accept package-relative file paths only. Traversal, URLs, percent signs, backslashes, and case conflicts are forbidden. Limits: 10,000 files per package, 512 MB per file, 2 GB total per package, and 100 packages per project. Only listed files are copied; source files are preserved. Links cannot escape the component's own directory.

Import by reading the revision, then running `node scripts/rusie.mjs component-import --project "<project-directory>" --from "<provider-directory>" --revision "<read-revision>"`. If the user or Skill has already placed the package at project components/id/, the browser extension-node view can check and register it by ID. Import uses revision checks, an exclusive lock, and rollback on failure; it does not overwrite an existing package. component.json is for import; story.components is authoritative afterward.

## Component entry points

Load the bridge from the package's index.html:

```html
<script src="../../shared/component-sdk.js"></script>
<script type="module" src="game.js"></script>
```

Adjust relative paths for nested entries. Wiring example:

```js
const node = await RusieNode.connect();
const { graph, role, state, config, checkpoint } = node.input;
// Run the provider's gameplay or computation.
await node.checkpoint({ progress: 2 });
await node.complete('solved', { score: 80 });
```

- `connect()`: connect once per page; returns input and the bridge API. Rejects without a host handshake.
- `complete(outcome, result = {})`: submit a result. The host validates visit, exit conditions, shape, and bounds, then updates variables and position together. Unknown exits, wrong types, out-of-range numbers, paused submissions, and duplicates are rejected.
- `checkpoint(json)`: submit internal progress for the current node, cleared on transition. The host coalesces saves with a delay and returns the checkpoint on restore. Checkpoints cannot modify story variables.
- `fail(message)`: report failure without bypassing the node or advancing the story.
- `onControl(callback)`: receive pause/resume/dispose. Components must stop or resume their own input, audio, engine loops, and other resources. The host rejects completion while paused and closes the message channel/removes the iframe on disposal.

Checkpoints and individual input/result/bridge messages are limited to 64 KiB, JSON depth 16, and 5,000 entries. Graph data and each role's definition data are limited to 256 KiB. Each playthrough allows 10,000 choices and 4 MiB total serialized history. Over-limit submissions leave state unchanged. Startup timeout defaults to 30 seconds and allows 1–120 seconds. Interaction timeout defaults to 30 minutes and allows 1 second to 1 hour. Each component may send at most 30 messages per second; exceeding this closes its channel. Browser sandboxes cannot guarantee interruption of infinite loops; timers are not hard execution quotas.

## Cocos integration

Users build the Web target in their own Creator project and provide the complete required build output as a component. Add component.json, preserve generated scripts/resource directories and relative references, and load the bridge in the entry HTML. The Creator authoring tool is not a viewer runtime dependency; the Skill does not distribute the engine.

After game startup, call connect() and retain the controller. Feed declared node.input configuration into the game. Call complete() on success/failure and checkpoint() when progress should be saved. Map onControl to pause, resume, and cleanup for the provider's pinned engine version. Implement specific engine calls against that version rather than assuming unverified fixed cc APIs.

Prefer ordinary Web builds without cross-origin isolation, SharedArrayBuffer, or same-origin storage requirements. Special builds needing those capabilities require separate adaptation and acceptance checks. Do not force compatibility by granting a node the editor's same-origin privileges. Internal tests cover modules, fetched resources, and the bridge. Providers must independently validate actual Cocos builds for each version.

## Isolation, export, and deployment

Components run in opaque-origin iframes with `sandbox="allow-scripts"`, without allow-same-origin, popups, forms, or top-level navigation. Local component HTML responses also carry CSP sandbox, so opening the entry directly does not grant editor-origin access. The bridge handshakes only with the current window and transfers a dedicated MessageChannel; `origin: null` alone does not establish trust. The parent neither evals component scripts nor writes copy through innerHTML.

The local HTTP service enables CORS only for listed component files and the public SDK. Editor APIs still check origin and token. Component CSP restricts resources to its own package and SDK; script/eval permission stays inside the component environment. Manifests and security headers do not establish code trust, impose hard CPU/memory quotas, or block every possible network path. The scope is author-supplied local packages of known provenance, not a security guarantee for a public untrusted plugin marketplace.

Exports with custom nodes include serve.mjs and the Windows launcher `启动作品.cmd`, requiring Node.js 20+. They can run offline when all resources are bundled. The launcher serves only manifest-listed static work files, without editor APIs. Its default port is stable per project ID so browser saves survive restarts. On conflict, stop an old instance or use `node serve.mjs --port <port> --open`; a different port changes the browser storage origin.

For static hosting, set `Access-Control-Allow-Origin: *` on components/, shared/component-sdk.js, and shared/control-node.js. Keep CSP sandbox and resource restrictions on component HTML. Avoid hosting a work on the same origin as important account data; the site must configure its own response headers correctly. Pure-film projects still support direct HTML opening.

All files in an offline project remain visible to local users. Field projections do not implement offline secrecy, anti-cheat, or multiplayer authorization. Multiplayer requires an authoritative service to verify results and distribute visible data separately.
