# dsh-workspace-scope

[![ci](https://github.com/Ri0n72Y/dsh-workspace-scope/actions/workflows/ci.yml/badge.svg)](https://github.com/Ri0n72Y/dsh-workspace-scope/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/dsh-workspace-scope)](https://www.npmjs.com/package/dsh-workspace-scope) [![DSH compatibility](https://img.shields.io/badge/DSH%20baseline-0.2.1--rc.5-f59e0b)](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.5) [![license](https://img.shields.io/github/license/Ri0n72Y/dsh-workspace-scope)](https://github.com/Ri0n72Y/dsh-workspace-scope/blob/main/LICENSE) [![release](https://img.shields.io/github/v/release/Ri0n72Y/dsh-workspace-scope)](https://github.com/Ri0n72Y/dsh-workspace-scope/releases)

为 DeepSeek Harness 按工作区启用或禁用当前 Agent 已拥有的 Skill 与 Host 全局 MCP。

本插件只做能力范围控制，不负责安装、发现或提供 Skill / MCP。不同工程可以通过各自的 `.dsh-scope.json` 暴露不同的能力集合。

English: [README.en.md](README.en.md)

> [!IMPORTANT]
> `dsh-workspace-scope v0.5.4` **以 DeepSeek Harness `0.2.1-rc.5` 为构建与验证基线**。`engines.dsh >=0.2.1-rc.2` 保留对先前兼容版本的加载许可；实际回归测试目标为 `rc.5`，不代表所有后续版本都已测试。Web 侧使用 `rc.5` 的真实依赖运行 frozen install、类型检查、构建、测试及 coverage gate。Desktop 仍需完成已打包应用上的安装、UI 与策略 smoke，才可宣称实机验证。

## 安装

需要已安装 `dsh` CLI：

```sh
dsh plugin --profile web add dsh-workspace-scope
```

卸载：

```sh
dsh plugin --profile web remove dsh-workspace-scope
```

Desktop `0.2.1-rc.5` 请从侧栏 **插件** 页面安装 `dsh-workspace-scope`。Desktop 使用保留的 `desktop` profile，公开 CLI 不直接管理该 profile；插件管理器会使用 Desktop 自己的 profile 与 pnpm 安装链路。

## 使用

在新建会话的空白 Session 中，点击输入卡右侧的「工作区能力」。

界面会显示当前 Agent 可由模型调用的 Skill，以及 Host 全局 MCP 服务器。切换 Agent Preset 后，列表会随当前 Agent 更新。开关、搜索、全部启用和全部禁用都会立即保存到工作区根目录的 `.dsh-scope.json`。

配置在会话第一次真正发起模型请求时锁定。因此开始对话前的修改会应用到该会话；之后的修改只影响新的会话。

默认只限制主对话，不限制子代理。勾选「子代理」后，根工作区的同一份策略也会限制子代理的 Skill 和 Host 全局 MCP。子代理仍从自己的有效工作目录发现 Skill；插件不读取子目录里的其他 `.dsh-scope.json`。

## 配置

通常直接使用 UI 即可。也可以手动编辑工作区根目录的 `.dsh-scope.json`：

```json
{
  "default": {
    "mode": "whitelist",
    "skills": ["<skill-name>"],
    "mcps": ["<server-name>"],
    "subagents": false
  }
}
```

- `default`：全部启用。
- `whitelist`：仅启用列表中的能力。
- `blacklist`：禁用列表中的能力。
- `skills`：Skill 名称。
- `mcps`：Host 全局 MCP server 名称。
- `subagents`：是否对子代理也应用 Workspace 限制；默认 `false`，旧配置无需修改。

## 边界

- Skill 范围来自当前 Agent 已有的 model-invocable Skill；本插件不会安装或补充 Skill。
- 禁用 Skill 控制的是模型调用能力。是否仍可通过 `/skill-name` 手动调用，由该 Skill 自身的 DSH `userInvocable` 策略决定。
- MCP 只管理 Host 全局注册并由 Agent 继承的 MCP；Agent / Preset 作用域内注册的 Tool / MCP 不在管理范围内。
- 当前 0.5.x 不支持名称中包含 `__` 的 MCP `serverName`；普通 tool name 可以包含 `__`。

实现细节、数据流与 C4 图见 [docs/architecture.md](docs/architecture.md)。版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 贡献

发现 bug 或有想法可以直接开 issue。提交 PR 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

MIT
