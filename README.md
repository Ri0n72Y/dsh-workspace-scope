# workspace-scope

[![ci](https://github.com/Ri0n72Y/workspace-scope/actions/workflows/ci.yml/badge.svg)](https://github.com/Ri0n72Y/workspace-scope/actions/workflows/ci.yml) [![license](https://img.shields.io/github/license/Ri0n72Y/workspace-scope)](https://github.com/Ri0n72Y/workspace-scope/blob/main/LICENSE) [![release](https://img.shields.io/github/v/release/Ri0n72Y/workspace-scope)](https://github.com/Ri0n72Y/workspace-scope/releases)

DeepSeek Harness 插件：按工作区（工程）启停 Skill 与 MCP。

安装的技能和 MCP 服务器越多，每个新会话的启动上下文就越大。这个插件让每个工程只启用自己需要的部分，效果类似 VS Code 装了多种语言插件，但每个工程只打开用得到的那几个。

English version: [README.en.md](README.en.md)

## 用法

入口在新建会话界面：输入卡右侧工具行里的「工作区能力」按钮。已进行的对话不显示入口，配置在对话开始时锁定，只影响该工作区之后新建的会话。

弹窗按「技能」和「MCP 服务器」两个分组列出全部条目，每组标题可以单独折叠：

- 搜索框过滤条目
- 每行一个开关，打开即启用
- 点行本身展开详情（技能显示描述，MCP 显示工具数量）
- 底部有「全部启用」「全部禁用」快捷按钮，所有改动即时保存

保存后配置写入当前工作区根目录的 `.dsh-scope.json`，只影响该工作区之后新建的会话。对话一旦开始，配置就固定下来，中途修改不会影响已开始的对话。被排除的技能仍可用 `/技能名` 手势在会话中临时加载。

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
| `mcps` | `string[]` | 启用的 MCP 服务器名列表 |

## 数据流

```mermaid
flowchart LR
    A[用户打开弹窗] --> B[勾选启用的 Skill 与 MCP]
    B --> C[保存]
    C --> D[.dsh-scope.json<br/>工作区根]
    E[新建会话] --> F[pre-step 读取配置]
    D --> F
    F --> G[技能目录消息<br/>裁剪为启用集]
    F --> H[MCP 工具<br/>restrict 为启用服务器]
    G --> I[模型上下文]
    H --> I
    J[工具执行前] --> K[兜底拒绝被排除技能<br/>/技能名 手势不受影响]
    K --> I
```

## 贡献

发现 bug 或有想法，直接开 issue；想动手改，先读 [CONTRIBUTING.md](CONTRIBUTING.md) 再提 PR。提交即表示同意按 MIT 许可授权。

## License

MIT
