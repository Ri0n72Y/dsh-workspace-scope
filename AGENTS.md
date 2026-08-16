# AGENTS.md

## 项目

workspace-scope 是 DeepSeek Harness（DSH）的 Cordis 插件：按工作区（工程）启停 Skill 与 MCP，控制新会话的启动上下文。静态部署形式是标准 DSH Bundle；`dsh.dynamic` 段只用于热测试。

## 常用命令（工作目录 workspace-scope/）

- `pnpm run check`：typecheck + tsdown 双产物构建（lib/index.js + lib/client.js）
- `pnpm run gen:dynamic`：从 src/client/index.tsx 生成 src/client/dynamic.tsx。改 client 源码后必须跑
- `pnpm run deploy`：`pnpm run prepare` + `dsh plugin --profile web add .`（静态部署，需要用户授权）
- 热测试循环：`dev_plugin_build`（compile-dynamic.mjs 编译 dist/dynamic）→ `dev_plugin_load`（新 Package + update）→ 浏览器验证。client 半部更新后通常还要再 `cordis_run`（run 模式重启）才在浏览器挂载

## 架构要点

- 双半部。Host（src/index.ts，Node）：pre-step 按工作区配置裁剪技能目录消息、`agent.ctx.tools.restrict` 裁剪 MCP 工具、`tools/pre-execute` 兜底拒绝被排除技能、overview/save 接口。Client（src/client/index.tsx，浏览器）：入口条与弹窗。
- 双环境数据通道。动态 client 沙盒禁 import/fetch，走 `harness.handle`（Host 侧）+ `host.call`（Client 侧）；静态 bundle 走 webServer 路由 `/api/workspace-scope`（GET overview / POST save）。Client 的 callHost() 按 `typeof host !== 'undefined'` 分流。
- dynamic.tsx 是脚本产物：头部 @ts-nocheck、`declare const React: any`、`apply(ctx: any)`，其余必须与 index.tsx 逐字一致。gen-dynamic.mjs 校验 marker，缺了就报错。
- 入口座位：hero 用 conversation.input.right（紧凑 chip，blank===true 时渲染）；活跃会话用 conversation.composer.dock（环境带，blank!==true 时渲染）。互斥靠 useSessions 的 blank 判定。弹窗挂在 shell.overlay，模块级 modalOpen + modalListeners 让两个入口共享开关状态。
- 配置：工作区根 .dsh-scope.json，`default` 键 {mode, skills[], mcps[]}。UI 保存恒写 whitelist（勾选即启用）；读取兼容 legacy default/blacklist。会话锁：appliedConfigs 按 agent.id 在首轮 pre-step 锁定，修改配置不影响已开始的会话。
- 写配置必须显式 `sandboxPolicy.resolve({ session, mode: 'workspace-write' })`（UI 管理操作，不受会话只读模式影响）。

## UI 约定

- 文案中文，代码注释英文。
- 样式只用 `--dsw-*` 主题变量（零硬编码颜色），主题切换自动换肤。CSS 以字符串数组内联在 index.tsx 顶部（动态沙盒禁 bundler/import 的约束，不要改成 import css 文件）。
- 类名前缀 `wsc-`。交互参考 harness 设置页的插件清单页：折叠行 + 详情、搜索框、分组标题可折叠（data-collapsed 控制箭头旋转）。
- Switch 是自绘 `button[role=switch]`（harness 无现成组件）：轨道 28×16、滑块 12×12、启用色 `--dsw-alias-state-business-primary`、焦点环 `--dsw-alias-state-business-primary`。

## 已知取舍（动相关代码前先读）

- tool-skill 的目录消息每轮重注入：digest 基于全量快照，过滤后每步日志多一条相同 catalog 事件，模型看到的目录内容正确。
- `DSH_TOOLS_MODE=code` 下 MCP 部分静默失效（serverToolsMap 为空），`native`/`both` 正常。
- 与 ../session-scope（旧动态版）不兼容，两者会互相覆盖 default 键，勿同时运行。
- 弹窗没有完整 focus trap：仅打开时聚焦面板（tabIndex=-1）+ Esc 关闭 + aria-modal，键盘 Tab 可进入背景页面，接受此状态。
- Playwright 后台标签页会冻结 CSS 过渡：transition 中的属性 computed 值会压过 inline/important，验证 transform/颜色过渡需临时 `transition:none`。

## 产品边界（不做什么）

- 不安装、不增删、不编辑 MCP 或技能配置（MCP 配置以 cordis.patch.yml 为准）
- 不做全局启停，不做全局查看面板
- 不管理技能库
