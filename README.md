# Interactive Film Solution Skill

Repository: `interactive-film-skill`. Product name: 互动型影视解决方案 Skill.

An extensible interactive film skill for Codex and Claude Code, with a local editor and inheritable control nodes for custom assets, events, and UI.

The public extension type is **ControlNode**. A fixed **BaseNode** encapsulates the bridge, immutable base definition, selected inputs, lifecycle, checkpoints and result submission. Inherit the control node to define your own choices, inputs, styles, history, inventory, assets and runtime events. Providers supply their complete Web runtime and resource files.

The architecture has two layers: the graph controls the overall lifecycle, while a persistent canvas manages background, video, portrait and dialogue. Video tails remain during choices and node transitions until the next video's first frame is ready. An explicit background change cuts the old tail on node entry, even if the next node starts with another video.

No complete story, game or demo media is included in the distribution. The default editor starts with a blank project. Node.js 20+ is required; no dependency installation, frontend build, desktop shell or model API key is needed.

## Start

```sh
npm run dev
```

This opens a blank local project in `.local/project/`; use the complete URL printed by the server. To edit an existing project:

```sh
npm run dev -- --project /path/to/my-film
```

## AI interface

- [ControlNode and BaseNode API](rusie-film/references/control-nodes.md): inheritance, overridable view methods, arbitrary events and package assets.
- [Canvas and graph lifecycle](rusie-film/references/canvas-lifecycle.md): four editable layers, tail-frame transitions, explicit scene cuts and AI production rules.
- [Type declarations](rusie-film/assets/shared/control-node.d.ts): public methods and data contracts.
- [Component protocol](rusie-film/references/custom-nodes.md): package manifests, input projection, outputs and routing.
- [Project format](rusie-film/references/project-format.md) and [common asset library](rusie-film/references/asset-library.md).

Extensions own their rendering. The host validates completion of the current node through its existing edges; extensions do not mutate the base node or jump to arbitrary nodes. Existing project format `rusie.film/2`, storage field `custom`, CLI and skill identifier `rusie-film` remain compatible.

## Source layout

```text
interactive-film-skill/
├── rusie-film/              Installable skill
│   ├── SKILL.md             Instructions for AI tools
│   ├── assets/              Editor, player, BaseNode / ControlNode SDK
│   ├── scripts/             CLI, server, project operations
│   ├── references/          Public interfaces and contracts
│   ├── templates/           Blank project definition
│   └── tests/               Repository-only checks and fixtures
├── scripts/                Development, testing and packaging
└── docs/                   Architecture and development notes
```

Distribute the complete `rusie-film` directory through the repository; no ZIP or build is required. See [installation and CLI](rusie-film/README.md). `npm run pack` is an optional development tool for a directory copy and SHA-256 manifest, excluding tests, fixtures, local projects and exports; it is not required for skill distribution.

## Development

```sh
npm test
npm run test:control
npm run pack
```

Browser checks require Node.js 22+ and installed Chrome/Chromium; set `CHROME_BINARY` if needed. Read [architecture](docs/architecture.md), [development](docs/development.md), and [workspace boundaries](docs/workspace-boundaries.md). Earlier workspace projects remain outside the current repository scope.
