# MCP Integrations Guide

Cortivex exposes 17 MCP tools for AI agent pipeline orchestration. This guide provides ready-to-use configurations for every major AI coding tool that supports MCP.

> **Quick setup:** Run `cortivex setup-mcp` to auto-generate the config for your tool.

---

## Claude Desktop

**Config file:** `claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cortivex": {
      "command": "npx",
      "args": ["-y", "cortivex", "serve", "--mcp"]
    }
  }
}
```

<details>
<summary>Local install (from GitHub clone)</summary>

```json
{
  "mcpServers": {
    "cortivex": {
      "command": "node",
      "args": ["<path-to-cortivex>/packages/mcp-server/dist/index.js"]
    }
  }
}
```
</details>

---

## Cursor

**Config:** Settings > Features > MCP Servers > Add Server

```json
{
  "mcpServers": {
    "cortivex": {
      "command": "npx",
      "args": ["-y", "cortivex", "serve", "--mcp"]
    }
  }
}
```

Or add to your project's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cortivex": {
      "command": "npx",
      "args": ["-y", "cortivex", "serve", "--mcp"]
    }
  }
}
```

---

## Windsurf

**Config:** Settings > MCP Servers > Add Custom Server

```json
{
  "mcpServers": {
    "cortivex": {
      "command": "npx",
      "args": ["-y", "cortivex", "serve", "--mcp"],
      "env": {}
    }
  }
}
```

---

## Cline (VS Code Extension)

**Config file:** `cline_mcp_settings.json`

Open Cline > MCP Servers icon > Configure > Advanced MCP Settings:

```json
{
  "mcpServers": {
    "cortivex": {
      "command": "npx",
      "args": ["-y", "cortivex", "serve", "--mcp"],
      "disabled": false
    }
  }
}
```

---

## VS Code (GitHub Copilot)

**Requires:** VS Code 1.99+ with `chat.mcp.enabled: true`

**Config file:** `.vscode/mcp.json` (workspace) or User Settings

```json
{
  "servers": {
    "cortivex": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "cortivex", "serve", "--mcp"]
    }
  }
}
```

Or via Command Palette: `MCP: Add Server` > Stdio > enter the command above.

---

## Continue.dev

**Config file:** `.continue/config.yaml` or `.continue/mcpServers/cortivex.yaml`

```yaml
mcpServers:
  - name: cortivex
    command: npx
    args:
      - "-y"
      - cortivex
      - serve
      - "--mcp"
```

Continue accepts configs in JSON format from Claude Desktop, Cursor, or Cline as well.

---

## Zed

**Config file:** `settings.json` (Zed > Settings > Open Settings)

```json
{
  "context_servers": {
    "cortivex": {
      "command": {
        "path": "npx",
        "args": ["-y", "cortivex", "serve", "--mcp"]
      },
      "settings": {}
    }
  }
}
```

Or open Agent Panel (Cmd+Shift+A) > View Server Extensions.

---

## JetBrains / Amazon Q Developer

**Config file:** `.amazonq/default.json` (project) or `~/.aws/amazonq/default.json` (global)

Also accessible via: Settings > Tools > AI Assistant > Model Context Protocol

```json
{
  "mcpServers": {
    "cortivex": {
      "command": "npx",
      "args": ["-y", "cortivex", "serve", "--mcp"]
    }
  }
}
```

---

## Available Tools

Once connected, these 17 tools are available in your AI assistant:

| Tool | Description |
|------|-------------|
| `cortivex_run` | Execute a pipeline by name |
| `cortivex_create` | Create a pipeline from description |
| `cortivex_status` | Check pipeline run status |
| `cortivex_list` | List available pipelines and templates |
| `cortivex_stop` | Stop a running pipeline |
| `cortivex_mesh` | Query agent mesh coordination state |
| `cortivex_insights` | Get learning insights from past runs |
| `cortivex_history` | Get execution history |
| `cortivex_export` | Export pipeline to n8n/YAML/JSON |
| `cortivex_knowledge` | Query shared knowledge graph |
| `cortivex_decompose` | Decompose task into subtasks |
| `cortivex_nodes` | List available agent node types |
| `cortivex_templates` | List pipeline templates |
| `cortivex_config` | Get/set Cortivex configuration |
| `cortivex_tasks` | List active tasks across pipelines |
| `cortivex_scale` | Adjust agent pool size |
| `cortivex_agent` | Get agent details from a run |

---

## Troubleshooting

**Server not starting:**
- Ensure Node.js 20+ is installed: `node --version`
- Ensure Cortivex is accessible: `npx cortivex --version`
- Check that `packages/mcp-server/dist/index.js` exists (run `npm run build` if needed)

**Tools not appearing:**
- Restart your AI tool after adding the config
- Check the tool's MCP server logs for connection errors
- Verify the config JSON syntax is valid

**Permission errors:**
- Some tools require explicit approval per tool call (Zed, VS Code)
- Grant permissions when prompted on first use
