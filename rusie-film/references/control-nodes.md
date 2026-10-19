# Control nodes: public interface for AI

`ControlNode` is the sole public extension-node type. `BaseNode` encapsulates the fixed connection, immutable base definition, inputs, pause/resume/dispose lifecycle, checkpoints, and completion. Extend `ControlNode`, or `BaseNode` for a fully custom view. Choices, inputs, styles, history, and inventory are overridable view methods, not additional node types. Distribution contains no complete example work.

The system follows the [canvas + control architecture](canvas-lifecycle.md). The graph owns overall flow; background, video, portrait, and dialogue lifetimes are independent of control lifetime. Disposing a control must not also clear a retained video frame. Plan node entry, pre-video playback, control startup, completion, and disposal before composing a work.

Implementation: `assets/shared/control-node.js`; types: `assets/shared/control-node.d.ts`. Components import `../../shared/control-node.js` over HTTP; it loads the underlying bridge. Adjust the relative path for nested entry files. Storage keeps `type: "custom"` and `custom`, without a second executor; the base definition's kind is `control`. Built-in film scenes and endings remain compatible.

## Inheritance entry point

```js
import { ControlNode } from '../../shared/control-node.js';

class MyControlNode extends ControlNode {
  async onChoice(choice, values) {
    await this.complete({ action: choice.id, values });
  }
}

await MyControlNode.start({ root: document.getElementById('root') });
```

This is interface wiring, not a work or game example. Declare `action` as `string` and `values` as `json` in `custom.result`; match current outgoing edges against `lastNode.output.action`. Providers supply their own page, gameplay, runtime, and resource manifest.

## Fixed BaseNode boundary

| Interface | Semantics |
| --- | --- |
| `static start({root})` | Handshake, construct the derived class, call `onStart()`, then `render(input.config.view ?? {})` |
| `input` | Deeply frozen projections of graph/current-role/session data, configuration, checkpoint, and base definition |
| `definition` | Read-only `{id, kind:'control', inputs, result, choices:[{id,label}]}`; no target or graph rewriting |
| `root` | DOM root inside the current component |
| `canvas.set(layer, patch)` / `canvas.clear(layer)` | Modify background, video, portrait, and dialogue layers without changing the base node definition |
| `paused` / `disposed` | Read-only lifecycle state |
| `complete(output)` | Finish the current node once; satisfy its result declaration and match exactly one of its own edges |
| `complete(outcome, output)` | Compatible explicit selection of an existing exit on the current node |
| `checkpoint(json)` | Save internal progress for this visit; cleared on entry to the next node |
| `asset(relativePath)` | Resolve a resource URL within the current component root; any extension is allowed if listed in the manifest |
| `fire(name, payload)` | Dispatch a custom runtime event to this instance's `onEvent`, without a predefined gameplay-event enum |

Base definitions and inputs cannot be mutated in place. Derived classes own views, computation, and temporary UI state. The host validates visit, pause state, result types, and current edges. A component cannot jump arbitrarily or rewrite other nodes.

## Overridable methods

| Method | Purpose |
| --- | --- |
| `onStart()` | Initialize a bundled engine, data, or event listeners |
| `render(view)` | Replace the entire control view, or extend default rendering |
| `applyStyles(css)` | Customize styles inside the isolated component document |
| `renderChoices(choices)` | Choice buttons, layout, and interaction |
| `renderInputs(fields)` | Forms or fully custom input controls |
| `values()` | Convert inputs; ordinary fields default to strings, checkboxes to booleans |
| `onChoice(choice, values)` | Handle a choice, compute results, and call `complete(output)` when appropriate |
| `renderHistory(records)` | Custom history view |
| `renderInventory(items)` | Custom inventory view |
| `onEvent(name, payload)` | Events dispatched through `fire()` by DOM, media, or engine code |
| `onCanvasEvent(event)` | Video first-frame, ended, blocked, and error events; forwards to onEvent by default |
| `onPause()` / `onResume()` / `onDispose()` | Engine pause, resume, and resource cleanup |
| `onError(error)` | Present control-interaction errors |

Default `render(view)` creates five slots: `styles/history/inventory/inputs/choices`. Empty history and inventory are hidden. `slots` and `view` are replaceable and are not part of the base definition. Override all rendering or individual methods. Default buttons guard pending work; custom asynchronous buttons should also avoid duplicate side effects.

When `view.choices` is omitted, the base definition's exit labels are shown and only generate choice events. An explicit empty array hides them. The derived class decides how to compute and submit output in `onChoice`.

`view` comes from `custom.config.view`. Common keys are `styles`, `choices`, `inputs`, `history`, and `inventory`; derived classes may interpret additional configuration. Buttons may carry `output` and optional `outcome` for direct submission, or `event` to trigger `onEvent`. Without output, a button dispatches `choose` by default and does not advance automatically. Event handlers may update views, collect input, or finish the node.

## History and inventory data

`custom.inputs.history: true` explicitly exposes the most recent 50 completed transitions as `{from, choice, to}`. Otherwise history is omitted. It excludes previous outputs, variables, and private role data. Authors can arrange complete dialogue logs through declared data, checkpoints, or results. History presentation is fully overridable.

Inventory has no fixed item format, award rules, or style. Store item definitions in graph or role data, ownership in declared session variables or the current checkpoint, then compute and call `renderInventory()` in the derived class. Render lists, images, HTML, or engine UI as needed. Catalog registration alone does not award items.

## Assets and runtime

Custom assets are not limited to the catalog's common categories. Providers may bundle video, audio, images, fonts, models, WASM, engine resources, or their own data, interpreted by their code. List resources in `component.json.files` and required runtime dependencies in `runtime.files`. `asset()` only resolves a URL; actual loading still checks the file manifest and component-directory boundary. Catalog categories are convenience entry points, not an extension-asset ceiling.

Import according to the [component, graph-data, and result protocol](custom-nodes.md). Keep base nodes and completion fixed; implement gameplay through inheritance and packages rather than host special cases for particular minigames. View overrides run inside the current node's isolated component and do not acquire parent DOM, editor credentials, or cross-node write access.
