# Local project format

The authoritative file is `story.json` in the project directory. Legacy pure-film works use `rusie.film/1`; graph data, role definitions, components, and custom nodes use `rusie.film/2`, described in the [custom-node protocol](custom-nodes.md). Both are independent of legacy role graphs in `rusie.graph/1`; those graphs are not migrated automatically. Distribution does not include example works. The minimal protocol structure is:

```json
{
  "format": "rusie.film/1",
  "id": "my-film",
  "title": "My interactive film",
  "start": "opening",
  "variables": { "found": false },
  "assets": [{ "id": "clip-a", "label": "Opening.mp4", "path": "assets/opening.mp4" }],
  "nodes": [
    {
      "id": "opening", "title": "Opening", "text": "Text displayed after the clip.",
      "video": "clip-a", "ending": false,
      "choices": [{ "id": "search", "label": "Search for clues", "target": "end", "set": { "found": true } }]
    },
    { "id": "end", "title": "Ending", "text": "The story ends.", "video": null, "ending": true, "choices": [] }
  ]
}
```

Project, node, asset, choice, and variable IDs start with an ASCII letter, followed by ASCII letters, digits, underscores, or hyphens, up to 64 characters. constructor / prototype / __proto__ are forbidden. Choice IDs are unique within their node; other IDs are unique within their respective collections. Display titles and descriptions support Unicode, including Chinese.

## Story flow

Ordinary nodes require at least one choice; ending nodes require an empty choices array. Each choice has id, label, and target, with optional:

- `when: {"variable":"found","equals":true}`: display only when the current variable strictly equals this value. Only single-variable equality is supported; no expressions or code are executed.
- `set: {"found":true}`: apply assignments after a successful choice, then enter the target node. Referenced variables must already be declared; assignment and condition values must match their initial types.

variables holds initial finite numbers, booleans, or strings. Ordinary nodes have no automatic state-changing side effects on entry; custom-node results still pass through shared completion. Limits: 500 nodes, 500 video assets, 100 variables, 20 choices or result exits per node, and a 4 MB story.json.

video is an asset ID or null. Text-only nodes display choices immediately; video nodes wait for natural playback completion. Playback errors do not automatically skip a clip. All copy is displayed through textContent, without executing HTML.

## Assets and persistence

Optional catalog entries hold non-video authoring assets: character scripts, items, audio, backgrounds, portraits, dialogue, and HTML package references. See the [asset catalog](asset-library.md) for fields, limits, and execution boundaries.

Video asset paths must be relative .mp4 paths inside assets/. URLs, backslashes, traversal, percent signs, and query parameters are rejected. Spaces and Chinese filenames are supported. Imports preserve the source and copy a new file. Browser uploads allow up to 512 MB per file, stream into a temporary file, validate the MP4 container header, then register it. Container checks do not verify decoding.

Browser saves and the save command share a project-exclusive lock, content-hash revisions, and temporary-file replacement. Reads and writes check real paths. Media serving and export do not follow links outside the project. AI must use read → save; third-party direct file writes do not receive these collaboration guarantees. Tools do not automatically take over leftover locks. After an abnormal exit, confirm that the original process has stopped before removing the project's .rusie-write.lock.

Choices must match the current visit; repeating an old visit does not change state. A playthrough records at most 10,000 choices to bound loops, memory, and storage growth. Saves record the chosen path and restore by validated replay; manually edited saved variables are not trusted. Node-boundary saves do not record video playback seconds. A revised work uses a new save namespace.

## Extension boundary

Optional `extensions` is an object preserved without interpretation or execution. It reserves versioned extension metadata, not implemented multiplayer or permission rules. Single-player nodes do not require role, room, or synchronization fields.

`assets/shared/story.js` provides `RusieStory.createLocalSession(story, start?)`, returning:

- `snapshot()`: independent copies of start, node, variables, history, and visit.
- `available()`: copies of choices available in the current state.
- `choose(choiceId, expectedVisit)`: validate visit and conditions, then commit assignments and transition.
- `complete(outcome, result, expectedVisit)`: custom-node completion; validate results, then apply declared capture/set assignments and transition.
- `finish(output, expectedVisit)`: select exactly one current outgoing edge using lastNode.output conditions, with atomic validation and state commit.
- `input()`: only the current custom node's declared graph, role, state, and internal-progress inputs.
- `checkpoint(json, expectedVisit)`: save bounded JSON progress inside the current custom node.
- `restore(saved)`: replay valid history without partially changing the current session on failure.
- `subscribe(listener)`: subscribe to successful commits; returns an unsubscribe function.

This is the future replacement boundary for session-state ownership. Networking requires separate identity, authoritative state, private projections, and transactions. Synchronizing a local object does not implement authorization.

Custom-node edges may use `when: {source: 'lastNode.output', field: 'route', equals: 'radio'}` to read top-level scalar fields of the current completion's output. Session snapshots include lastNode, reconstructed from history on restore. See the custom-node protocol for constraints.
