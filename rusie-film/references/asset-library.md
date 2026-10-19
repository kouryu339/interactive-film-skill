# Categorized asset catalog

MP4 files retain the existing assets array and node.video references for compatibility with the player and import flow. HTML animation remains a complete package registered in components and uses the existing custom-node bridge. The optional catalog array organizes other authoring assets and requires rusie.film/2.

| kind | Editor category | Content |
| --- | --- | --- |
| script | Character story / script | Plain-text or Markdown text; optional role |
| item | Item | text description; optional image path |
| audio | MP3 / audio | path; MP3/WAV/OGG supported |
| background | Background | path; PNG/JPG/JPEG/WebP supported |
| portrait | Character portrait | Image path; optional role |
| dialogue | Dialogue | Dialogue text; optional role |
| html | HTML animation | component reference to a complete registered package |

Each record has a unique id, a nonempty name, and kind. Optional nodes lists associated story nodes. IDs follow node ID rules and are unique within catalog. Maximum: 500 entries. role must reference an existing role; nodes must contain distinct existing node IDs. Remove associations before deleting referenced roles or nodes. Files must stay inside assets/; external URLs, traversal, and links outside the project are rejected.

```json
{
  "format": "rusie.film/2",
  "catalog": [
    { "id": "detective-story", "kind": "script", "name": "Detective script", "role": "detective", "text": "# Fog Harbor\nYou received a letter.", "nodes": ["arrival"] },
    { "id": "cabin-key", "kind": "item", "name": "Brass key", "text": "Opens the maintenance door." },
    { "id": "rain", "kind": "audio", "name": "Rain", "path": "assets/rain.mp3" },
    { "id": "room", "kind": "background", "name": "Waiting room", "path": "assets/room.png" },
    { "id": "face", "kind": "portrait", "name": "Detective portrait", "role": "detective", "path": "assets/detective.webp" },
    { "id": "talk", "kind": "dialogue", "name": "Interview", "text": "detective: Have you seen this person?" },
    { "id": "intro-html", "kind": "html", "name": "Web opening", "component": "opening-web" }
  ]
}
```

This fragment omits required project, node, role, component, and video definitions; it is not a standalone project. Text is limited to 200,000 characters per entry, and each entry's JSON to 1 MB, within the overall story.json limit of 4 MB. Dialogue text preserves the source wording; text in the form `character: dialogue` is not automatically compiled into execution instructions.

## File import

The editor streams audio/image imports with a 64 MB limit, file-header checks, and content-hash revision checks. Failed imports remove temporary files; original files are not overwritten. Header checks do not guarantee decoding in every browser. Preview in the target browser.

AI can read the revision, then run:

```text
node scripts/rusie.mjs asset-import --project <project-directory> --kind audio --from <local-MP3-file> --revision <read-revision>
```

kind may be audio/background/portrait/item. AI can write text assets to catalog through read → save. HTML/game packages use component-import, or copy the full package into project components/ and register it by ID in the extension-node view. Registered packages appear in the HTML category automatically. HTML preview requires at least one custom node configured for that component, with explicit input and result declarations. Source files are not inserted directly into editor DOM.

Export copies all registered audio/images, embeds text in the work definition, and copies component resources according to the complete manifest. Deleting a record does not delete its disk file. catalog.nodes records authoring references without implicit execution. Controls select registered visual assets by ID through scoped canvas commands or load resources from their own component manifest, without editor credentials or arbitrary file access.

## Scene presentation and dialogue (0.5+)

A node may explicitly set `presentation: {background: 'room', portrait: 'face', dialogue: 'talk'}`, referencing matching catalog entries. Since 0.7, omitted background inherits the canvas, while portrait/dialogue content clears on transition by default. Explicit null clears the layer; node background:null also cuts the preceding video's retained frame. Selected assets cannot be deleted or have their IDs changed until those references are removed.

Follow the [canvas + control lifecycle](canvas-lifecycle.md). Apply background on entry; an explicit background cuts the preceding frame even when the node has a pre-video. Then play node.video, if present. Retain its final frame, show portraits/dialogue over it, then show choices or mount the control. With no explicit background on the next node, retain background and video frame until a new video presents its first frame. Clear portraits and unfinished dialogue on transition. Omitting background inherits; explicit background:null clears background and the old frame.

Dialogue prefers the asset's lines array, falling back to nonempty lines in text. A leading role ID, role name, or narrator marker identifies the speaker. The parser recognizes prefixes such as `roleId:`, `Role name:`, `narrator:`, and the Chinese narrator marker `旁白：`, including supported full-width colon forms. Only matched prefixes are stripped; unmatched text remains unchanged. All copy uses textContent without executing HTML. Speaker resolution uses existing project roles; arbitrary prefixes do not create new roles.

Story choices are hidden during dialogue and appear after the final line is confirmed. Selecting dialogue suppresses duplicate fallback narration from node.text. Dialogue changes neither session variables nor choice history. Reloading replays the current node from the beginning without a saved line cursor. This feature does not add built-in item awards, automatic MP3 playback, or automatic script display. Projects with presentation require a 0.5+ editor/exporter; canvas inheritance semantics require 0.7+.
