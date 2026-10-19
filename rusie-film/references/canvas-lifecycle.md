# Canvas + control: graph lifecycle and overridable layers

Plan every node according to this contract before composing a work. The public extension remains `ControlNode`; the four visual layers do not introduce four new node types.

## Responsibilities of the two layers

**The graph drives the control layer**: enter a node → apply entry directives → play its pre-video → run dialogue → mount the control / wait for choices → validate output → commit once → dispose the current control → enter the next node. The graph owns node timing, branching, variable commits, pause/resume, cancel/retry, and ending. `BaseNode.onStart` runs after the current node's pre-video and dialogue finish. A control completes only itself; it cannot jump arbitrarily or rewrite the graph.

**The canvas holds persistent presentation state**: background, video, portrait, and dialogue are managed separately. A transition disposes the old control without destroying the whole canvas or retained video frame. Controls can modify layer content and styles. Visual changes alone neither complete a node nor modify node.video or outgoing-edge definitions.

| Layer | Default behavior on entry | Editable content |
| --- | --- | --- |
| background | Inherit when omitted; explicitly setting it replaces the background and clears the preceding video's final frame | Registered backgrounds, component resources, CSS |
| video | Retain the current final frame when no new video plays; replace only when the next video's first frame is ready | Video resources, styles, explicit clearing; the host owns frame handoff and retention lifetime |
| portrait | Clear on transition and rebuild from the current definition | Registered portraits, component resources, CSS |
| dialogue | Clear on transition; enter the control phase after current dialogue completes | Text, speakers, line sequences, CSS |

Restarting the story or closing the page clears the canvas. Retrying a node retains its current image until the new video presents a frame. Canceling a control pauses its canvas media; reaching an ending pauses the canvas while retaining its final image. Reloading does not persist a decoder or final frame; saves reconstruct the current node's presentation.

Layer styles persist until explicitly changed or reset by restarting the graph. Default entry cleanup rebuilds portrait and dialogue content only. Restore node-specific styles through the corresponding node configuration or events when needed.

## Required final-frame handoff rules

1. When node A's pre-video ends, retain its actual video element and final frame. Show the current choices/control over that frame.
2. After the viewer chooses B, keep A's frame visible while B downloads, decodes, or waits for playback permission.
3. Once B's first frame can actually be presented, show B and release A in the same handoff. Prefer `requestVideoFrameCallback`; do not replace A merely when setting src, receiving loadedmetadata, or completing the node.
4. If B has no new video and no explicit background, inherit A's frame, even across multiple control nodes.
5. **If B explicitly sets a background, cut A's retained frame immediately during B's entry phase, even when B also has a pre-video.** Show the new background while awaiting B's first frame. Reassigning the same background ID still counts as an explicit scene cut.
6. Retain B's own final frame after its video ends. Its entry background directive must not hide B again.

For continuous branches, target nodes should specify their branch video without automatically adding presentation.background. `video: null` means no new playback, not clearing the old frame. `presentation.background: null` explicitly clears both background and the preceding retained frame; omission means inheritance.

When generating assets, obtain A's actual final frame and use that same reference to constrain every branch's first frame, character positions, camera, and aspect ratio. A reference frame is production data; do not automatically assign it as the node background just to record the reference. Asset indexes or generation records can live in graph data. Runtime retention does not generate or verify visual continuity. Report when the final frame has not actually been viewed or extracted.

## Public four-layer API for controls

Use `BaseNode.canvas` / `ControlNode.canvas`; the underlying bridge also exposes `node.canvas`:

```ts
canvas.set(layer, patch): Promise<void>
canvas.clear(layer): Promise<void>
```

`layer` is `background | video | portrait | dialogue`. Supported patch fields:

- `asset`: a registered asset ID matching the layer; video uses assets, other layers use catalog.
- `source`: a resource path listed in the current component's manifest. Prefer `this.asset('relative/file')`. Other components, editor paths, and external sites are rejected.
- `style`: CSS properties with string values. Use native CSS names such as `object-fit`, `opacity`, and `transform`. Style-only changes do not switch the background or clear a retained frame.
- `alt`: an image/resource description.
- Dialogue accepts `text`, `speaker`, or `lines: [{name, text}]`. Render text literally; do not execute string code.

Choose either asset or source. Set it to null, or call clear, to clear a layer. Clearing the background layer alone does not implicitly clear video. For a scene cut, set background content or explicitly clear video as well. Commands affect presentation only; `complete(output)` still owns node completion. Writes from paused or stale nodes are rejected.

```js
await this.canvas.set('portrait', {
  source: this.asset('images/actor.webp'),
  style: { transform: 'translateX(-8%)' }
});
```

`onCanvasEvent({layer, phase})` receives video `frame / ended / blocked / error` events and forwards them to `onEvent('canvas:' + phase, event)` by default. A layer video's end does not automatically finish the graph node; the extension decides whether to submit. Browsers may require a viewer gesture before playback. Provide a retry interaction on blocked events.

## Overriding layer renderers

The canvas host uses `RusieCanvas.create({picture, screen, renderers})`. Supply per-layer rendering functions or call `canvas.override(layer, renderer)` without changing graph completion:

- Background/portrait/dialogue renderers receive `{root, value, done}`, render inside root, and may return a cleanup function or `{dispose, pause?, resume?}` lifecycle object. Dialogue must call done when finished.
- Video renderers receive `{root, source}` and return `{video, element?, dispose?, pause?, resume?}`. video must be a real HTMLVideoElement; element is an optional wrapper. The canvas still owns first-frame handoff, final-frame retention, and media release. A custom view must contain that video; clean up additional animation resources through lifecycle hooks.

This is a host integration API. It does not automatically execute component-supplied JS in the parent page. Isolated controls modify the four layers through the JSON commands above; complex custom views stay inside their own components without parent DOM or editor access. Video overrides must preserve frame handoff, retention lifetime, and error handling rather than bypassing the media controller.
