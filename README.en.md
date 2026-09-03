# dsh-workspace-scope

[![ci](https://github.com/Ri0n72Y/dsh-workspace-scope/actions/workflows/ci.yml/badge.svg)](https://github.com/Ri0n72Y/dsh-workspace-scope/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/dsh-workspace-scope)](https://www.npmjs.com/package/dsh-workspace-scope) [![license](https://img.shields.io/github/license/Ri0n72Y/dsh-workspace-scope)](https://github.com/Ri0n72Y/dsh-workspace-scope/blob/main/LICENSE) [![release](https://img.shields.io/github/v/release/Ri0n72Y/dsh-workspace-scope)](https://github.com/Ri0n72Y/dsh-workspace-scope/releases)

## The Plugin is under actively development, will be released frequently

A DeepSeek Harness plugin that turns Skills and Host-global MCP servers on and off per workspace.

The more skills and global MCP servers you install, the larger the startup context of every new session. This plugin lets each project enable only what it needs, like VS Code with many language packs where each project opens only the ones it uses.

MCP scope here explicitly means Host-global MCP tools inherited by an Agent. MCP servers registered inside an Agent or Preset scope are outside this plugin's management boundary.

中文版：[README.md](README.md)

## Usage

The entry lives on the new-session screen: the "Workspace scope" button in the tool row of the input card. Ongoing conversations do not show it. The config locks when that conversation starts its first real model request, so changes made on the new-session screen still apply to the conversation about to start; later file edits do not mutate a locked conversation.

The dialog lists all manageable entries under two groups, Skills and global MCP servers, and each group heading can be collapsed on its own:

- A search box filters the entries
- Each row has a switch; on means enabled
- Clicking the row expands details (description for skills, tool count for global MCP servers)
- Enable all / disable all quick buttons at the bottom; every change saves immediately

Saving writes the config to `.dsh-scope.json` in the workspace root. The first prompt assembly owned by a model turn reads and locks that config. When the effective Host-global MCP deny set changes, the plugin updates the Agent's native `tools.restrict()` mask and asks DSH to rebuild the complete prompt assembly once, so native and PTC tool presentation use the same policy. Skills are refreshed from the locked config at each pre-step. Excluded skills that remain user-invocable can still be loaded ad hoc with the `/skill-name` gesture.

## Configuration

The file is `.dsh-scope.json` in the workspace root:

```json
{
  "default": {
    "mode": "whitelist",
    "skills": ["<skill-name>"],
    "mcps": ["<server-name>"]
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `mode` | `string` | Always saved as `whitelist`; reading accepts `default` (everything enabled) and `blacklist` (list means excluded) |
| `skills` | `string[]` | Enabled skill names |
| `mcps` | `string[]` | Enabled Host-global MCP server names |

## Data flow

```mermaid
flowchart LR
    A[User opens the dialog] --> B[Toggles Skills and global MCP servers]
    B --> C[Save]
    C --> D[.dsh-scope.json<br/>workspace root]
    E[First real system-prompt/assemble] --> F[Read and lock config]
    D --> F
    F --> G[Compute Host-global MCP deny set]
    G --> H{Mask changed?}
    H -->|Yes| I[tools.restrict]
    I --> J[Rebuild complete assembly once]
    H -->|No| K[Keep current assembly]
    J --> L[Model-visible tools / PTC SDK]
    K --> L
    M[agent/pre-step] --> N[Refresh Skill shadows]
    N --> O[Native DSH Skill catalog / skill tool]
    P["/skill-name"] --> Q[Original userInvocable policy preserved]
```

## Contributing

Open an issue for bugs or ideas. Before sending a pull request, read [CONTRIBUTING.md](CONTRIBUTING.md). By contributing you agree to the MIT license.

## License

MIT
