# 开发与验证

产品名为“互动型影视解决方案 Skill”，仓库名为 `interactive-film-skill`。既有安装标识和协议保留 `rusie-film` / `rusie.film/2`。扩展层只公开 `ControlNode`，基础实现为 `BaseNode`，底层存储兼容 `custom`。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 在 `.local/project` 创建并打开空作品，不注入示例 |
| `npm run dev -- --project <path>` | 打开已有作品 |
| `npm test` | 全部单元测试 |
| `npm run test:control` | 继承、视图覆写、事件、输入、提交与独立导出 |
| `npm run test:canvas` | 延迟视频加载、跨节点尾帧、背景切断及画布覆写 |
| `npm run test:browser` | MP4 流程与独立导出 |
| `npm run test:editor` | 编辑器保存、布局与冲突 |
| `npm run test:custom` | 底层组件桥与生命周期兼容 |
| `npm run test:catalog` | 素材导入与预览 |
| `npm run test:presentation` | 背景、立绘和对话 |
| `npm run pack` | 生成全新的运行包和逐文件 SHA-256 清单 |

产品运行需要 Node.js 20+。浏览器测试需要 Node.js 22+ 和 Chrome/Chromium，可用 `CHROME_BINARY` 指定路径。素材测试自建短音频，不依赖 FFmpeg。测试报告、截图和临时项目位于 `rusie-film/.test-output/`，不提交。当前验证平台为 Windows。

`rusie-film/tests/fixtures/` 仅保留自动化所需的内部输入数据；不作为作者示例、不进入分发包。新建作品只使用 `templates/story.json` 的空定义。原完整演示在工作区历史制作记录中保留，当前代码不依赖它们。

改动公开接口时，同时检查 `references/control-nodes.md`、SDK `.d.ts`、组件 CSP/CORS 及独立导出的支持文件。渲染与事件可以扩展，基础定义、输入投影和完成提交的宿主校验不能由视图绕过。

图拥有控制生命周期，画布拥有图层状态。视频尾帧不跟随控件销毁，下一视频首帧就绪才替换；显式背景指令在进入节点时切断旧尾帧。变更前先读 `references/canvas-lifecycle.md`。画布命令只改变呈现，不能自动完成节点。

打包只包含 assets、references、scripts、templates、README、SKILL.md 和 package.json。测试、fixtures、历史作品和本地项目均排除。输出已存在时拒绝覆盖；可用 `node scripts/package.mjs --out dist/<new-name>` 选择新位置。
