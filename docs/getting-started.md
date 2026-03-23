# Getting Started with Cortivex

This guide walks you through installing Cortivex, running your first pipeline, and understanding the output. By the end, you will have a working pipeline that reviews code, finds bugs, or runs security scans with coordinated AI agents.

---

## Prerequisites

Before installing Cortivex, make sure you have the following:

- **Node.js 20 or later.** Cortivex uses ES modules and modern Node APIs. Check your version with `node --version`.
- **Claude Code installed and configured.** Cortivex skills run inside Claude Code. Install it from [claude.ai/code](https://claude.ai/code) if you have not already.
- **A git repository.** Cortivex operates on git repos. Most pipeline templates expect a working tree with committed code.

Optional but recommended:

- **npm 9+** for global installs.
- **A GitHub remote** if you plan to use PR-related templates (pr-review, changelog-release, pre-release-check).

---

## Installation

Install Cortivex globally so the `cortivex` command is available everywhere:

```bash
npm install -g cortivex
```

Alternatively, install directly from GitHub:

```bash
npm install -g github:AhmedRaoofuddin/Cortivex
```

After the global install, install the Claude Code skills into your project:

```bash
cortivex install-skills
```

This copies 15 skill files into your project's `.agents/skills/` directory. Each skill is a self-contained operational manual that Claude Code loads automatically based on context. You do not need to reference them manually.

---

## Initializing a Project

Navigate to your project directory and run:

```bash
cd your-project
cortivex init
```

This creates a `.cortivex/` directory containing:

- `config.json`: project-level configuration (parallelism, cost limits, default models).
- `pipelines/`: where custom pipelines are saved.
- `history/`: execution history for the learning engine.
- `insights/`: accumulated optimization insights.

You only need to run `cortivex init` once per project.

---

## Your First Pipeline Run

Run the built-in PR review pipeline:

```bash
cortivex run pr-review
```

This executes a five-node pipeline:

1. **SecurityScanner**: Scans changed files for vulnerabilities, hardcoded secrets, and dependency CVEs.
2. **CodeReviewer**: Reviews code quality, naming, complexity, and error handling.
3. **AutoFixer**: Applies minimal, safe fixes for issues found by the first two nodes.
4. **TestRunner**: Runs your test suite to validate that fixes did not introduce regressions.
5. **PRCreator**: Updates your pull request with a structured summary of all findings.

Each node runs as a separate AI agent. Nodes with satisfied dependencies execute in parallel automatically. A typical PR review completes in about three minutes at a cost of roughly five cents.

You can also run pipelines from inside Claude Code using slash commands:

```
/cortivex run pr-review
```

---

## Creating a Custom Pipeline

Describe what you want in plain English:

```bash
cortivex create security-fix --description "find security issues and fix them"
```

Cortivex analyzes the description, selects appropriate agent node types, determines their dependencies, and generates a YAML pipeline definition. The pipeline is saved to `.cortivex/pipelines/security-fix.yaml`.

You can then run it:

```bash
cortivex run security-fix
```

More examples of natural language pipeline creation:

```bash
cortivex create ts-migrate --description "migrate all JS files to TypeScript"
cortivex create test-boost --description "run full test suite and boost coverage"
cortivex create release-prep --description "review code, write docs, and create a changelog"
```

---

## Understanding Pipeline Output

When a pipeline finishes, Cortivex prints a structured summary:

```
Pipeline: pr-review
Run ID: run_abc123
Status: completed
Duration: 142.3s
Total Cost: $0.0487
Total Tokens: 24851

Node Results:
  [OK] security_scan    18.2s ($0.0098)
  [OK] code_review      34.5s ($0.0142)
  [OK] auto_fix         52.1s ($0.0121)
  [OK] test_run          8.9s ($0.0024)
  [OK] pr_update         3.1s ($0.0012)
```

Each line shows:

- **Status**: `[OK]` for success, `[FAIL]` for failure, `[SKIPPED]` if a dependency failed.
- **Node ID**: The identifier from the pipeline definition.
- **Duration**: Wall-clock time for that agent.
- **Cost**: API cost for that agent's token usage.

If a node fails, the error message appears indented below it. The pipeline's `failureStrategy` controls what happens next: `stop` aborts remaining nodes, `continue` runs unaffected branches, and `retry` re-attempts the failed node.

---

## Dry-Run Mode for Cost Estimation

Before executing a pipeline, preview its estimated cost and structure:

```bash
cortivex run security-fix --dry-run
```

Dry-run mode parses the pipeline, validates the DAG, and reports:

- Number of nodes and their types.
- Estimated cost based on model and node type baselines.
- Estimated duration based on historical averages.
- Execution order showing which nodes run in parallel.

No agents are spawned and no API calls are made during a dry run. Use this to verify a pipeline before committing to execution, especially for custom pipelines generated from natural language.

---

## Viewing Available Templates

List all built-in and saved pipelines:

```bash
cortivex list
```

Filter to only built-in templates:

```bash
cortivex list --templates
```

Each entry shows the template name, description, node count, estimated cost, and estimated duration.

---

## Checking Pipeline Status

View the status of the most recent run:

```bash
cortivex status
```

Or check a specific run by ID:

```bash
cortivex status run_abc123
```

---

## Verbose Output

For real-time streaming output from each agent:

```bash
cortivex run pr-review --verbose
```

Verbose mode prints each agent's reasoning and actions as they happen, which is useful for debugging or understanding how the pipeline works.

---

## Where to Go Next

- **[Skill Reference](skill-reference.md)**: Detailed documentation for all 15 skills, their categories, and how they activate.
- **[API Reference](api-reference.md)**: MCP tool reference and HTTP API endpoints for programmatic access.
- **[Templates](templates.md)**: Complete listing of all 15 pipeline templates with cost and duration estimates.
