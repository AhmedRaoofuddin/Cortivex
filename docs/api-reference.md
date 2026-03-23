# API Reference

Cortivex provides two programmatic interfaces: an MCP server for Claude Code integration, and an HTTP server with REST endpoints for external clients. Both expose the same core functionality through different protocols.

---

## MCP Server

The MCP server communicates over stdio and exposes eight tools. It is the primary interface for Claude Code.

### Configuring the MCP Server

Add the Cortivex MCP server to your Claude Code settings (`~/.claude/settings.json` or project-level `.claude/settings.json`):

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

Once configured, the eight tools become available inside Claude Code sessions.

---

### Pipeline Tools

#### cortivex_run

Run a pipeline by name or from inline YAML/JSON.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pipeline` | string | yes | Pipeline name (e.g., "pr-review") or inline YAML/JSON definition. |
| `config.dryRun` | boolean | no | Simulate execution without running nodes. Default: false. |
| `config.failureStrategy` | string | no | Behavior on node failure: "stop", "continue", or "retry". Default: "continue". |
| `config.parallelism` | number | no | Maximum concurrent nodes. Default: 4. |
| `config.verbose` | boolean | no | Enable verbose output. Default: false. |
| `config.timeout` | number | no | Timeout in milliseconds. Default: 300000. |

**Example usage in Claude Code:**

```
Use cortivex_run to execute the pr-review pipeline with dryRun enabled.
```

---

#### cortivex_create

Create a new pipeline from a natural language description. The description is analyzed to select appropriate node types and dependencies. The generated pipeline is saved to `.cortivex/pipelines/`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Name for the pipeline file (e.g., "my-security-check"). |
| `description` | string | yes | Natural language description of the pipeline's purpose. |

---

#### cortivex_status

Check the status of a pipeline run. Returns per-node results with cost and duration.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `runId` | string | no | Specific run ID to check. If omitted, shows all active runs or the most recent completed run. |

---

#### cortivex_list

List available pipelines including saved user pipelines and built-in templates.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `type` | string | no | Filter: "saved" (user pipelines), "templates" (built-in), or "all" (default). |

---

### Knowledge Tools

#### cortivex_insights

Get learning insights from past pipeline executions. Returns cost optimizations, reliability improvements, and ordering suggestions with confidence scores.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pipeline` | string | no | Filter insights to a specific pipeline name. |

---

#### cortivex_history

Get execution history for past pipeline runs.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pipeline` | string | no | Filter history to a specific pipeline name. |
| `limit` | number | no | Maximum entries to return. Default: 10. |

---

### Mesh Tools

#### cortivex_mesh

Query the mesh coordination state. Returns current file ownership claims, active agents, and any file conflicts between agents.

**Parameters:** None.

---

### Utility Tools

#### cortivex_export

Export a pipeline in YAML, JSON, or n8n workflow format.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pipeline` | string | yes | Pipeline name or inline YAML/JSON. |
| `format` | string | yes | Export format: "yaml", "json", or "n8n". |

The n8n export generates a complete n8n workflow JSON with HTTP Request nodes pointing to the Cortivex HTTP server, preserving the DAG structure with proper node connections.

---

## HTTP Server

The HTTP server runs on port 3939 by default. Start it with:

```bash
cortivex serve
```

Or with a custom port:

```bash
cortivex serve --port 4000
```

The server exposes REST endpoints and a WebSocket endpoint for real-time pipeline events.

---

### Pipeline Endpoints

#### POST /api/pipeline/run

Run a pipeline by name or inline definition.

```bash
curl -X POST http://localhost:3939/api/pipeline/run \
  -H "Content-Type: application/json" \
  -d '{"pipeline": "pr-review"}'
```

With configuration options:

```bash
curl -X POST http://localhost:3939/api/pipeline/run \
  -H "Content-Type: application/json" \
  -d '{
    "pipeline": "pr-review",
    "config": {
      "dryRun": true,
      "parallelism": 2,
      "verbose": true
    }
  }'
```

---

#### POST /api/pipeline/create

Create a pipeline from natural language.

```bash
curl -X POST http://localhost:3939/api/pipeline/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-audit",
    "description": "scan for security issues and generate a report"
  }'
```

---

#### GET /api/pipeline/status/:runId

Get the status of a specific run.

```bash
curl http://localhost:3939/api/pipeline/status/run_abc123
```

---

#### GET /api/pipelines

List all available pipelines (saved and built-in).

```bash
curl http://localhost:3939/api/pipelines
```

---

### Mesh Endpoints

#### GET /api/mesh

Get current mesh state including file claims, active agents, and conflicts.

```bash
curl http://localhost:3939/api/mesh
```

#### GET /api/mesh/conflicts

Get only current file conflicts.

```bash
curl http://localhost:3939/api/mesh/conflicts
```

---

### Learning Endpoints

#### GET /api/insights

Get learning insights and aggregate statistics. Optionally filter by pipeline name.

```bash
curl http://localhost:3939/api/insights
curl "http://localhost:3939/api/insights?pipeline=pr-review"
```

#### GET /api/history

Get execution history. Supports pipeline filter and result limit.

```bash
curl http://localhost:3939/api/history
curl "http://localhost:3939/api/history?pipeline=pr-review&limit=20"
```

---

### Export Endpoints

#### POST /api/export/n8n

Export a pipeline as an n8n workflow JSON.

```bash
curl -X POST http://localhost:3939/api/export/n8n \
  -H "Content-Type: application/json" \
  -d '{"pipeline": "pr-review"}'
```

The response includes the complete n8n workflow object ready to import, along with import instructions.

---

### Utility Endpoints

#### GET /api/health

Health check returning server status, version, uptime, and connected WebSocket clients.

```bash
curl http://localhost:3939/api/health
```

#### GET /api/info

Returns a list of all available endpoints with descriptions.

```bash
curl http://localhost:3939/api/info
```

---

### WebSocket

Connect to `ws://localhost:3939/ws` for real-time pipeline execution events. Events include node start, node completion, node failure, and pipeline completion. The dashboard uses this endpoint for its live execution view.
