# Workspace and repository boundaries

This workspace originally contained several implementation stages without a shared root Git repository. The maintained repository includes root documentation and package configuration, `rusie-film/`, `scripts/`, and `docs/`. Its remote is `https://github.com/kouryu339/interactive-film-skill`; the existing Apache 2.0 license is preserved.

The following local content stays in place and is excluded from repository commits:

| Local directory or file | Purpose and reason for preservation |
| --- | --- |
| `公共/` | Earlier assets, Spine tooling, and experiments; not required by the current Skill |
| `项目编辑器/` | Earlier editor implementation retained for reference |
| `项目解释器/` | Earlier interpreter implementations, contracts, and experiments |
| `桌面端/`, `启动桌面端.ps1` | Earlier Tauri desktop project and launcher |
| `mini-animation-skill/` | Independent Git repository; preserve its history and remote configuration |
| `作品/` | Local work copies, asset generation, and production records |
| `交付/` | Historical delivery packages, screenshots, and browser acceptance records |
| `dist/` | Regenerable packaging output |
| `rusie-film/.test-output/` | Local test reports, screenshots, and temporary projects |
| Root preview logs | Local service records |

The root `.gitignore` uses an explicit top-level allowlist to keep earlier projects, caches, and delivery artifacts out of Git. These local files are not deleted or moved, and the independent repository's configuration is unchanged. Existing local preview paths remain usable.

Complete former demos are archived under `作品/制作记录/repository-examples-v0.5.1/`. Repository-only test inputs remain in `rusie-film/tests/fixtures/`; they are excluded from the installable distribution. Distribute the complete Skill directory through Git without requiring a ZIP or build. No GitHub release or packaged artifact is created by source synchronization.
