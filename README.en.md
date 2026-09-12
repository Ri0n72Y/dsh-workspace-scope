# dsh-workspace-scope

[![ci](https://github.com/Ri0n72Y/dsh-workspace-scope/actions/workflows/ci.yml/badge.svg)](https://github.com/Ri0n72Y/dsh-workspace-scope/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/dsh-workspace-scope)](https://www.npmjs.com/package/dsh-workspace-scope) [![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.1.5--rc.1-2ea44f)](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1) [![license](https://img.shields.io/github/license/Ri0n72Y/dsh-workspace-scope)](https://github.com/Ri0n72Y/dsh-workspace-scope/blob/main/LICENSE) [![release](https://img.shields.io/github/v/release/Ri0n72Y/dsh-workspace-scope)](https://github.com/Ri0n72Y/dsh-workspace-scope/releases)

Enable or disable the current Agent's existing Skills and inherited Host-global MCP servers per DeepSeek Harness workspace.

This plugin only controls capability scope. It does not install, discover, or provide Skills or MCP servers. Each workspace can expose a different capability set through its own `.dsh-scope.json`.

中文版：[README.md](README.md)

## Install

Requires the `dsh` CLI:

```sh
dsh plugin --profile web add dsh-workspace-scope
```

Remove it with:

```sh
dsh plugin --profile web remove dsh-workspace-scope
```

## Usage

In a blank new-session Session, click "Workspace scope" on the right side of the input card.

The dialog shows model-invocable Skills from the current Agent and Host-global MCP servers. Switching Agent Presets refreshes the list for the current Agent. Toggles, search, enable-all, and disable-all save immediately to `.dsh-scope.json` in the workspace root.

The configuration locks when the conversation starts its first real model request. Changes made before that point apply to the conversation; later changes apply only to new conversations.

## Configuration

Normally the UI is enough. You can also edit `.dsh-scope.json` manually:

```json
{
  "default": {
    "mode": "whitelist",
    "skills": ["<skill-name>"],
    "mcps": ["<server-name>"]
  }
}
```

- `default`: enable everything.
- `whitelist`: enable only listed capabilities.
- `blacklist`: disable listed capabilities.
- `skills`: Skill names.
- `mcps`: Host-global MCP server names.

## Scope

- Skills come from the current Agent's existing model-invocable Skill view; this plugin does not install or add Skills.
- Disabling a Skill controls model invocation. Whether `/skill-name` remains available is determined by that Skill's native DSH `userInvocable` policy.
- MCP management covers only Host-global MCP servers inherited by the Agent. Tool / MCP registrations inside Agent or Preset scope are not managed.
- In 0.5.x, MCP `serverName` values containing `__` are unsupported; ordinary tool names may contain `__`.

Implementation details, data flow, and C4 diagrams live in [docs/architecture.md](docs/architecture.md). Release history lives in [CHANGELOG.md](CHANGELOG.md).

## Contributing

Open an issue for bugs or ideas. Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

## License

MIT
