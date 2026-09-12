# dsh-workspace-scope

[![ci](https://github.com/Ri0n72Y/dsh-workspace-scope/actions/workflows/ci.yml/badge.svg)](https://github.com/Ri0n72Y/dsh-workspace-scope/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/dsh-workspace-scope)](https://www.npmjs.com/package/dsh-workspace-scope) [![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.1.5--rc.1-2ea44f)](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1) [![license](https://img.shields.io/github/license/Ri0n72Y/dsh-workspace-scope)](https://github.com/Ri0n72Y/dsh-workspace-scope/blob/main/LICENSE) [![release](https://img.shields.io/github/v/release/Ri0n72Y/dsh-workspace-scope)](https://github.com/Ri0n72Y/dsh-workspace-scope/releases)

为 DeepSeek Harness 按工作区启用或禁用当前 Agent 已拥有的 Skill 与 Host 全局 MCP。

本插件只做能力范围控制，不负责安装、发现或提供 Skill / MCP。不同工程可以通过各自的 `.dsh-scope.json` 暴露不同的能力集合。

English: [README.en.md](README.en.md)

## 安装

需要已安装 `dsh` CLI：

```sh
dsh plugin --profile web add dsh-workspace-scope
```

卸载：

```sh
dsh plugin --profile web remove dsh-workspace-scope
```

## 使用

在新建会话的空白 Session 中，点击输入卡右侧的「工作区能力」。

界面会显示当前 Agent 可由模型调用的 Skill，以及 Host 全局 MCP 服务器。切换 Agent Preset 后，列表会随当前 Agent 更新。开关、搜索、全部启用和全部禁用都会立即保存到工作区根目录的 `.dsh-scope.json`。

配置在会话第一次真正发起模型请求时锁定。因此开始对话前的修改会应用到该会话；之后的修改只影响新的会话。

## 配置

通常直接使用 UI 即可。也可以手动编辑工作区根目录的 `.dsh-scope.json`：

```json
{
  "default": {
    "mode": "whitelist",
    "skills": ["<skill-name>"],
    "mcps": ["<server-name>"]
  }
}
```

- `default`：全部启用。
- `whitelist`：仅启用列表中的能力。
- `blacklist`：禁用列表中的能力。
- `skills`：Skill 名称。
- `mcps`：Host 全局 MCP server 名称。

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
