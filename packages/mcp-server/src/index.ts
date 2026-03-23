#!/usr/bin/env node
/**
 * Cortivex MCP Server
 *
 * Exposes 17 tools for building, running, and managing AI agent pipelines
 * via the Model Context Protocol over stdio.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { runTool } from './tools/run.js';
import { createTool } from './tools/create.js';
import { statusTool } from './tools/status.js';
import { listTool } from './tools/list.js';
import { meshTool } from './tools/mesh.js';
import { insightsTool } from './tools/insights.js';
import { historyTool } from './tools/history.js';
import { exportTool } from './tools/export.js';
import { stopTool } from './tools/stop.js';
import { knowledgeTool } from './tools/knowledge.js';
import { decomposeTool } from './tools/decompose.js';
import { nodesTool } from './tools/nodes.js';
import { templatesTool } from './tools/templates.js';
import { configTool } from './tools/config.js';
import { tasksTool } from './tools/tasks.js';
import { scaleTool } from './tools/scale.js';
import { agentTool } from './tools/agent.js';

// ── Tool Definitions ─────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'cortivex_run',
    description:
      'Run a Cortivex AI agent pipeline. Loads the pipeline by name (from .cortivex/pipelines/ or built-in templates) ' +
      'or from inline YAML/JSON, then executes all nodes through the DAG respecting dependencies. ' +
      'Returns a detailed execution summary with cost, duration, and success/failure per node.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pipeline: {
          type: 'string',
          description:
            'Pipeline name (e.g., "full-review", "quick-fix", "security-audit") or inline YAML/JSON pipeline definition.',
        },
        config: {
          type: 'object',
          description:
            'Optional execution configuration. Supports: dryRun (boolean), failureStrategy ("stop"|"continue"|"retry"), ' +
            'parallelism (number), verbose (boolean), timeout (number in ms).',
          properties: {
            dryRun: { type: 'boolean', description: 'Simulate execution without actually running nodes.' },
            failureStrategy: {
              type: 'string',
              enum: ['stop', 'continue', 'retry'],
              description: 'What to do when a node fails.',
            },
            parallelism: { type: 'number', description: 'Max concurrent nodes.' },
            verbose: { type: 'boolean', description: 'Enable verbose output.' },
            timeout: { type: 'number', description: 'Timeout in milliseconds.' },
          },
        },
      },
      required: ['pipeline'],
    },
  },
  {
    name: 'cortivex_create',
    description:
      'Create a new Cortivex pipeline from a natural language description. The description is analyzed to identify ' +
      'appropriate node types (CodeReviewer, SecurityScanner, TestRunner, AutoFixer, etc.) and their dependencies. ' +
      'The generated pipeline is saved to .cortivex/pipelines/ as YAML and returned.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Name for the pipeline (used as the filename, e.g., "my-review-pipeline").',
        },
        description: {
          type: 'string',
          description:
            'Natural language description of what the pipeline should do. Examples: ' +
            '"review my code and fix bugs", "run security scan then auto-fix", ' +
            '"full review with tests and PR creation".',
        },
      },
      required: ['name', 'description'],
    },
  },
  {
    name: 'cortivex_status',
    description:
      'Check the status of a pipeline run. If a runId is provided, returns detailed status for that specific run. ' +
      'Otherwise, shows all currently active runs or the most recent completed run.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        runId: {
          type: 'string',
          description: 'Optional run ID to check. If omitted, shows all active runs.',
        },
      },
    },
  },
  {
    name: 'cortivex_list',
    description:
      'List available pipelines. Shows saved user pipelines from .cortivex/pipelines/ and built-in templates. ' +
      'Each entry includes name, description, tags, and node count.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['saved', 'templates', 'all'],
          description: 'Filter by source: "saved" (user pipelines), "templates" (built-in), or "all" (default).',
        },
      },
    },
  },
  {
    name: 'cortivex_mesh',
    description:
      'Query the mesh coordination state. Shows current file ownership claims, active agents, and any conflicts ' +
      'between agents trying to modify the same files. The mesh prevents concurrent write conflicts during pipeline execution.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'cortivex_insights',
    description:
      'Get learning insights from past pipeline executions. The learning engine analyzes execution patterns ' +
      'across runs to surface cost optimizations, reliability improvements, performance recommendations, ' +
      'and ordering suggestions. Includes aggregate statistics (success rate, avg cost, etc.).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pipeline: {
          type: 'string',
          description: 'Optional pipeline name to filter insights for.',
        },
      },
    },
  },
  {
    name: 'cortivex_history',
    description:
      'Get execution history for pipeline runs. Shows past runs with status, duration, cost, and node results. ' +
      'Can be filtered by pipeline name and limited to a specific number of results.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pipeline: {
          type: 'string',
          description: 'Optional pipeline name to filter history for.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of history entries to return (default: 10).',
        },
      },
    },
  },
  {
    name: 'cortivex_export',
    description:
      'Export a pipeline in different formats. Supports YAML, JSON, and n8n workflow format. ' +
      'The n8n export generates a complete n8n workflow JSON with HTTP Request nodes pointing to ' +
      'the Cortivex HTTP server (localhost:3939), preserving the DAG structure with proper node connections.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pipeline: {
          type: 'string',
          description: 'Pipeline name or inline YAML/JSON to export.',
        },
        format: {
          type: 'string',
          enum: ['n8n', 'yaml', 'json'],
          description: 'Export format: "n8n" (n8n workflow JSON), "yaml", or "json".',
        },
      },
      required: ['pipeline', 'format'],
    },
  },
  {
    name: 'cortivex_stop',
    description:
      'Stop a running pipeline by its run ID. Cancels execution and stops all active nodes. ' +
      'Nodes that have already completed will retain their results. Use cortivex_status to find active run IDs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        runId: {
          type: 'string',
          description: 'The run ID of the pipeline to stop. Use cortivex_status to find active run IDs.',
        },
      },
      required: ['runId'],
    },
  },
  {
    name: 'cortivex_knowledge',
    description:
      'Query the shared CRDT knowledge graph. Shows entries discovered by agents during pipeline execution, ' +
      'including findings, relationships, and deduplication status. The knowledge graph prevents duplicate ' +
      'analysis across agents and enables cross-agent synthesis.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Optional search query to filter knowledge entries.',
        },
        nodeType: {
          type: 'string',
          description: 'Optional node type to filter entries by (e.g., "finding", "recommendation", "dependency").',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of entries to return (default: 50).',
        },
      },
    },
  },
  {
    name: 'cortivex_decompose',
    description:
      'Decompose a task description into subtasks with dependency ordering, priority assignment, and cost estimation. ' +
      'Analyzes the description to identify appropriate agent types and their execution order. ' +
      'Returns a structured task breakdown that can be used to create a pipeline.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        description: {
          type: 'string',
          description:
            'Natural language description of the task to decompose. Examples: ' +
            '"review code, fix bugs, and run tests", "migrate to TypeScript and update docs".',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum decomposition depth for nested subtasks (default: 3).',
        },
      },
      required: ['description'],
    },
  },
  {
    name: 'cortivex_nodes',
    description:
      'List all available agent node types with their configurations, default models, cost baselines, ' +
      'and success rates. Can be filtered by category (quality, security, testing, devops, docs, refactoring, analysis).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Optional category to filter node types: "quality", "security", "testing", "devops", "docs", "refactoring", "analysis".',
        },
      },
    },
  },
  {
    name: 'cortivex_templates',
    description:
      'List available pipeline templates with details. Templates are pre-built pipeline configurations ' +
      'for common tasks like PR review, security audit, test generation, and more. ' +
      'Each template includes node count, tags, and description.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tag: {
          type: 'string',
          description: 'Optional tag to filter templates (e.g., "security", "testing", "review").',
        },
      },
    },
  },
  {
    name: 'cortivex_config',
    description:
      'Get or set Cortivex configuration values. When action is "get", returns the current configuration ' +
      '(all keys or a specific key). When action is "set", updates a configuration value. ' +
      'Configuration is stored in .cortivex/config.json.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'set'],
          description: 'Action to perform: "get" to read config, "set" to update config.',
        },
        key: {
          type: 'string',
          description: 'Configuration key to get or set (e.g., "defaultModel", "parallelism", "verbose").',
        },
        value: {
          description: 'Value to set for the key (required when action is "set"). Can be string, number, boolean, or object.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'cortivex_tasks',
    description:
      'List active tasks across all running pipelines. Shows each node/agent task with its status, progress, ' +
      'cost, and which pipeline run it belongs to. Can be filtered by status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'running', 'completed', 'failed', 'skipped'],
          description: 'Optional status filter to show only tasks with a specific status.',
        },
      },
    },
  },
  {
    name: 'cortivex_scale',
    description:
      'Adjust the agent pool size to control how many agents run concurrently during pipeline execution. ' +
      'Can be set globally or per node type. Higher values increase parallelism but also increase API costs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        poolSize: {
          type: 'number',
          description: 'Desired pool size (1-20). Controls maximum concurrent agents.',
        },
        nodeType: {
          type: 'string',
          description: 'Optional node type to scope the pool size change (e.g., "CodeReviewer"). If omitted, sets the global pool size.',
        },
      },
      required: ['poolSize'],
    },
  },
  {
    name: 'cortivex_agent',
    description:
      'Get detailed information about a specific agent in a running or completed pipeline. ' +
      'Shows status, progress, cost, tokens, files modified, and output. ' +
      'Can search across all active runs or within a specific run.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: {
          type: 'string',
          description: 'The node ID of the agent to inspect (e.g., "security_scan", "code_review").',
        },
        runId: {
          type: 'string',
          description: 'Optional run ID to scope the search. If omitted, searches all active runs.',
        },
      },
      required: ['agentId'],
    },
  },
];

// ── Server Setup ─────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'cortivex',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ── List Tools Handler ───────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// ── Input Validation Helpers ─────────────────────────────────────────

/** Pipeline name pattern: alphanumeric, hyphens, underscores only */
const PIPELINE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function validatePipelineName(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error('Pipeline name must be a non-empty string');
  }
  if (name.length > 64) {
    throw new Error('Pipeline name must not exceed 64 characters');
  }
  if (!PIPELINE_NAME_PATTERN.test(name)) {
    throw new Error('Pipeline name may only contain alphanumeric characters, hyphens, and underscores');
  }
  return name;
}

function validateLimit(limit: unknown): number {
  if (limit === undefined || limit === null) return 10;
  const num = typeof limit === 'number' ? limit : parseInt(String(limit), 10);
  if (isNaN(num) || num < 1) return 1;
  if (num > 1000) return 1000;
  return num;
}

function validateString(value: unknown, fieldName: string, maxLength: number = 1024): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new Error(`${fieldName} must not exceed ${maxLength} characters`);
  }
  return value;
}

// ── Call Tool Handler ────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'cortivex_run': {
        const typedArgs = args as { pipeline: string; config?: Record<string, unknown> };
        validateString(typedArgs.pipeline, 'pipeline');
        // Validate pipeline name if it looks like a simple name (not inline YAML/JSON)
        if (!typedArgs.pipeline.includes('\n') && !typedArgs.pipeline.includes('{') && !typedArgs.pipeline.includes(':')) {
          validatePipelineName(typedArgs.pipeline);
        }
        return await runTool(typedArgs);
      }

      case 'cortivex_create': {
        const typedArgs = args as { name: string; description: string };
        validatePipelineName(typedArgs.name);
        validateString(typedArgs.description, 'description', 4096);
        return await createTool(typedArgs);
      }

      case 'cortivex_status': {
        const typedArgs = args as { runId?: string };
        if (typedArgs.runId !== undefined) {
          validateString(typedArgs.runId, 'runId', 256);
        }
        return await statusTool(typedArgs);
      }

      case 'cortivex_list': {
        const typedArgs = args as { type?: 'saved' | 'templates' | 'all' };
        if (typedArgs.type !== undefined) {
          const validTypes = ['saved', 'templates', 'all'];
          if (!validTypes.includes(typedArgs.type)) {
            throw new Error(`Invalid type "${typedArgs.type}". Must be one of: ${validTypes.join(', ')}`);
          }
        }
        return await listTool(typedArgs);
      }

      case 'cortivex_mesh':
        return await meshTool();

      case 'cortivex_insights': {
        const typedArgs = args as { pipeline?: string };
        if (typedArgs.pipeline !== undefined) {
          validatePipelineName(typedArgs.pipeline);
        }
        return await insightsTool(typedArgs);
      }

      case 'cortivex_history': {
        const typedArgs = args as { pipeline?: string; limit?: number };
        if (typedArgs.pipeline !== undefined) {
          validatePipelineName(typedArgs.pipeline);
        }
        typedArgs.limit = validateLimit(typedArgs.limit);
        return await historyTool(typedArgs);
      }

      case 'cortivex_export': {
        const typedArgs = args as { pipeline: string; format: 'n8n' | 'yaml' | 'json' };
        validateString(typedArgs.pipeline, 'pipeline');
        if (!typedArgs.pipeline.includes('\n') && !typedArgs.pipeline.includes('{') && !typedArgs.pipeline.includes(':')) {
          validatePipelineName(typedArgs.pipeline);
        }
        const validFormats = ['n8n', 'yaml', 'json'];
        if (!validFormats.includes(typedArgs.format)) {
          throw new Error(`Invalid format "${typedArgs.format}". Must be one of: ${validFormats.join(', ')}`);
        }
        return await exportTool(typedArgs);
      }

      case 'cortivex_stop': {
        const typedArgs = args as { runId: string };
        validateString(typedArgs.runId, 'runId', 256);
        return await stopTool(typedArgs);
      }

      case 'cortivex_knowledge': {
        const typedArgs = args as { query?: string; nodeType?: string; limit?: number };
        if (typedArgs.query !== undefined) {
          validateString(typedArgs.query, 'query', 2048);
        }
        if (typedArgs.limit !== undefined) {
          typedArgs.limit = validateLimit(typedArgs.limit);
        }
        return await knowledgeTool(typedArgs);
      }

      case 'cortivex_decompose': {
        const typedArgs = args as { description: string; maxDepth?: number };
        validateString(typedArgs.description, 'description', 4096);
        return await decomposeTool(typedArgs);
      }

      case 'cortivex_nodes': {
        const typedArgs = args as { category?: string };
        if (typedArgs.category !== undefined) {
          const validCategories = ['quality', 'security', 'testing', 'devops', 'docs', 'refactoring', 'analysis'];
          if (!validCategories.includes(typedArgs.category)) {
            throw new Error(`Invalid category "${typedArgs.category}". Must be one of: ${validCategories.join(', ')}`);
          }
        }
        return await nodesTool(typedArgs);
      }

      case 'cortivex_templates': {
        const typedArgs = args as { tag?: string };
        if (typedArgs.tag !== undefined) {
          validateString(typedArgs.tag, 'tag', 64);
        }
        return await templatesTool(typedArgs);
      }

      case 'cortivex_config': {
        const typedArgs = args as { action: 'get' | 'set'; key?: string; value?: unknown };
        const validActions = ['get', 'set'];
        if (!validActions.includes(typedArgs.action)) {
          throw new Error(`Invalid action "${typedArgs.action}". Must be one of: ${validActions.join(', ')}`);
        }
        if (typedArgs.key !== undefined) {
          validateString(typedArgs.key, 'key', 128);
        }
        return await configTool(typedArgs);
      }

      case 'cortivex_tasks': {
        const typedArgs = args as { status?: string };
        if (typedArgs.status !== undefined) {
          const validStatuses = ['pending', 'running', 'completed', 'failed', 'skipped'];
          if (!validStatuses.includes(typedArgs.status)) {
            throw new Error(`Invalid status "${typedArgs.status}". Must be one of: ${validStatuses.join(', ')}`);
          }
        }
        return await tasksTool(typedArgs);
      }

      case 'cortivex_scale': {
        const typedArgs = args as { poolSize: number; nodeType?: string };
        if (typeof typedArgs.poolSize !== 'number' || typedArgs.poolSize < 1 || typedArgs.poolSize > 20) {
          throw new Error('poolSize must be a number between 1 and 20');
        }
        if (typedArgs.nodeType !== undefined) {
          validateString(typedArgs.nodeType, 'nodeType', 128);
        }
        return await scaleTool(typedArgs);
      }

      case 'cortivex_agent': {
        const typedArgs = args as { agentId: string; runId?: string };
        validateString(typedArgs.agentId, 'agentId', 256);
        if (typedArgs.runId !== undefined) {
          validateString(typedArgs.runId, 'runId', 256);
        }
        return await agentTool(typedArgs);
      }

      default:
        return {
          content: [{
            type: 'text',
            text: `Unknown tool: "${name}". Available tools: ${TOOLS.map((t) => t.name).join(', ')}`,
          }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: 'text',
        text: `Error executing tool "${name}": ${message}`,
      }],
      isError: true,
    };
  }
});

// ── Start ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Cortivex MCP server started on stdio');
}

main().catch((error) => {
  console.error('Fatal error starting Cortivex MCP server:', error);
  process.exit(1);
});
