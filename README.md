# dsh-workspace-scope

[![ci](https://github.com/Ri0n72Y/dsh-workspace-scope/actions/workflows/ci.yml/badge.svg)](https://github.com/Ri0n72Y/dsh-workspace-scope/actions/workflows/ci.yml) [![license](https://img.shields.io/github/license/Ri0n72Y/dsh-workspace-scope)](https://github.com/Ri0n72Y/dsh-workspace-scope/blob/main/LICENSE) [![release](https://img.shields.io/github/v/release/Ri0n72Y/dsh-workspace-scope)](https://github.com/Ri0n72Y/dsh-workspace-scope/releases)

## 插件正在积极开发中，版本更新频繁

DeepSeek Harness 插件：按工作区（工程）启停 Skill 与 Host 全局 MCP。

安装的技能和全局 MCP 服务器越多，每个新会话的启动上下文就越大。这个插件让每个工程只启用自己需要的部分，效果类似 VS Code 装了多种语言插件，但每个工程只打开用得到的那几个。

这里的 MCP 范围明确指 Host 全局注册、由 Agent 继承的 MCP 工具；Agent / Preset 自己作用域内注册的 MCP 不由本插件管理。

English version: [README.en.md](README.en.md)

## 用法

入口在新建会话界面：输入卡右侧工具行里的「工作区能力」按钮。已进行的对话不显示入口，配置在对话开始时锁定，只影响该工作区之后新建的会话。

弹窗按「技能」和「全局 MCP 服务器」两个分组列出全部可管理条目，每组标题可以单独折叠：

- 搜索框过滤条目
- 每行一个开关，打开即启用
- 点行本身展开详情（技能显示描述，全局 MCP 显示工具数量）
- 底部有「全部启用」「全部禁用」快捷按钮，所有改动即时保存

保存后配置写入当前工作区根目录的 `.dsh-scope.json`，只影响该工作区之后新建的会话。会话启动时插件先锁定配置，并在首个模型上下文组装前应用 Host 全局 MCP 策略；之后每个 pre-step 按同一份锁定配置刷新 Skill，Host 全局 MCP 注册表发生变化时再刷新 MCP 策略。中途修改 `.dsh-scope.json` 不会改变已开始的会话。被排除但原本允许用户调用的技能仍可用 `/技能名` 手势在会话中临时加载。

## 配置

文件在工作区根目录，名为 `.dsh-scope.json`：

```json
{
  "default": {
    "mode": "whitelist",
    "skills": ["<skill-name>"],
    "mcps": ["<server-name>"]
  }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `mode` | `string` | 保存时固定为 `whitelist`；读取兼容 `default`（全部启用）与 `blacklist`（列表为排除集） |
| `skills` | `string[]` | 启用的技能名列表 |
| `mcps` | `string[]` | 启用的 Host 全局 MCP 服务器名列表 |

## 数据流

```mermaid
flowchart LR
    A[用户打开弹窗] --> B[勾选启用的 Skill 与全局 MCP]
    B --> C[保存]
    C --> D[.dsh-scope.json<br/>工作区根]
    E[agent/session-start] --> F[runMaintenance<br/>读取并锁定配置]
    D --> F
    F --> G[tools.restrict<br/>首个 prompt assembly 前应用 Host 全局 MCP]
    H[agent/pre-step] --> I[复用锁定配置刷新 Skill shadow]
    I --> J[DSH 原生 Skill catalog / skill tool]
    K[tools/change] --> L[Host 全局 MCP inventory 变化]
    L --> G
    M[/技能名] --> N[保留原 userInvocable 策略]
```

## 贡献

发现 bug 或有想法，直接开 issue；想动手改，先读 [CONTRIBUTING.md](CONTRIBUTING.md) 再提 PR。提交即表示同意按 MIT 许可授权。

## License

MIT
