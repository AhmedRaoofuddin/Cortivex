#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import {
  PipelineLoader,
  PatternExtractor,
  MeshManager,
  HistoryRecorder,
  nodeRegistry,
} from '@cortivex/core';

const program = new Command();

program
  .name('cortivex')
  .description(
    'Build, run, and evolve AI agent pipelines. Zero infrastructure. Agents that coordinate and learn.'
  )
  .version('1.0.0');

// --- init ---
program
  .command('init')
  .description('Initialize Cortivex in the current directory')
  .option('-f, --force', 'Reinitialize even if already set up')
  .action(async (options: { force?: boolean }) => {
    try {
      await initCommand(options);
    } catch (error) {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });

// --- run ---
program
  .command('run <pipeline>')
  .description('Run a pipeline by name or path')
  .option('-d, --dry-run', 'Preview execution without running')
  .option('-v, --verbose', 'Show detailed output')
  .option('-m, --model <model>', 'Override the model for all nodes')
  .option('-p, --parallel <n>', 'Max parallel node execution (default: 4)')
  .option(
    '-s, --strategy <strategy>',
    'Failure strategy: stop, continue, retry (default: stop)'
  )
  .option('-r, --retries <n>', 'Max retries per node (default: 1)')
  .option('--no-learn', 'Disable applying learned optimizations')
  .action(async (pipelineName: string, options) => {
    try {
      await runCommand(pipelineName, options);
    } catch (error) {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });

// --- create ---
program
  .command('create <name>')
  .description('Create a new pipeline from a description')
  .option('-d, --description <desc>', 'Pipeline description')
  .option('-t, --template <template>', 'Start from a built-in template')
  .action(
    async (
      name: string,
      options: { description?: string; template?: string }
    ) => {
      try {
        const cwd = process.cwd();
        const loader = new PipelineLoader(cwd);

        console.log('');

        if (options.template) {
          const template = loader.getTemplate(options.template);
          if (!template) {
            console.log(
              chalk.red(`  Template "${options.template}" not found.`)
            );
            console.log('');
            console.log(chalk.gray('  Available templates:'));
            const templates = loader.listTemplates();
            for (const t of templates) {
              console.log(
                chalk.white(`    ${t.id}`) +
                  chalk.gray(` — ${t.description}`)
              );
            }
            console.log('');
            process.exit(1);
          }

          // Write the template as a new pipeline
          const pipeline = template.pipeline;
          pipeline.name = name;
          if (options.description) {
            pipeline.description = options.description;
          }

          const { writeFile } = await import('node:fs/promises');
          const { join } = await import('node:path');
          const { stringify } = await import('yaml');

          const filePath = join(
            cwd,
            '.cortivex',
            'pipelines',
            `${name}.yaml`
          );
          await writeFile(filePath, stringify(pipeline), 'utf-8');

          console.log(
            chalk.green(`  Created pipeline "${name}" from template "${options.template}"`)
          );
          console.log(
            chalk.gray(`  File: .cortivex/pipelines/${name}.yaml`)
          );
        } else {
          // Interactive creation
          console.log(
            chalk.cyan(`  Creating pipeline "${name}"`)
          );
          console.log('');
          console.log(chalk.gray('  Available node types:'));
          console.log('');

          const categories = nodeRegistry.getCategories();
          for (const category of categories) {
            const nodes = nodeRegistry.listByCategory(category);
            console.log(
              chalk.bold(`  ${category.toUpperCase()}`)
            );
            for (const node of nodes) {
              console.log(
                chalk.white(`    ${node.id}`) +
                  chalk.gray(` — ${node.description.slice(0, 60)}...`)
              );
            }
            console.log('');
          }

          console.log(chalk.gray('  Use --template <name> to start from a template.'));
          console.log(
            chalk.gray(
              `  Or create a YAML file manually at .cortivex/pipelines/${name}.yaml`
            )
          );
        }

        console.log('');
      } catch (error) {
        console.error(
          chalk.red(
            `Error: ${error instanceof Error ? error.message : String(error)}`
          )
        );
        process.exit(1);
      }
    }
  );

// --- list ---
program
  .command('list')
  .description('List available pipelines and templates')
  .option('-t, --templates', 'Show only built-in templates')
  .option('-n, --nodes', 'Show available node types')
  .action(
    async (options: { templates?: boolean; nodes?: boolean }) => {
      try {
        const cwd = process.cwd();
        const loader = new PipelineLoader(cwd);

        console.log('');

        if (options.nodes) {
          console.log(chalk.bold.cyan('  Available Node Types'));
          console.log('');

          const categories = nodeRegistry.getCategories();
          for (const category of categories) {
            const nodes = nodeRegistry.listByCategory(category);
            console.log(
              chalk.bold(`  ${category.toUpperCase()} (${nodes.length})`)
            );
            for (const node of nodes) {
              console.log(
                `    ${chalk.hex(node.color)('\u25cf')} ${chalk.white(node.id)} ${chalk.gray('—')} ${chalk.gray(node.description.slice(0, 65))}`
              );
              console.log(
                chalk.gray(
                  `      Model: ${node.defaultModel} | Avg cost: $${node.avgCost.toFixed(2)} | Success: ${(node.successRate * 100).toFixed(0)}%`
                )
              );
            }
            console.log('');
          }
          console.log('');
          return;
        }

        const pipelines = await loader.listPipelines();

        // Built-in templates
        const builtIn = pipelines.filter(
          (p) => p.source === 'built-in'
        );
        if (builtIn.length > 0) {
          console.log(
            chalk.bold.cyan('  Built-in Templates')
          );
          console.log('');
          for (const p of builtIn) {
            console.log(
              `  ${chalk.green('\u25cf')} ${chalk.bold.white(p.name)} ${chalk.gray('—')} ${chalk.gray(p.description)}`
            );
            console.log(
              chalk.gray(
                `    ${p.nodeCount} nodes | Tags: ${p.tags.join(', ')}`
              )
            );
          }
          console.log('');
        }

        // User pipelines
        if (!options.templates) {
          const userPipelines = pipelines.filter(
            (p) => p.source === 'user'
          );
          if (userPipelines.length > 0) {
            console.log(
              chalk.bold.cyan('  Custom Pipelines')
            );
            console.log('');
            for (const p of userPipelines) {
              console.log(
                `  ${chalk.blue('\u25cf')} ${chalk.bold.white(p.name)} ${chalk.gray('—')} ${chalk.gray(p.description)}`
              );
              console.log(
                chalk.gray(
                  `    ${p.nodeCount} nodes | Tags: ${p.tags.join(', ')}`
                )
              );
            }
            console.log('');
          } else if (!options.templates) {
            console.log(
              chalk.gray(
                '  No custom pipelines. Run "cortivex init" to get started.'
              )
            );
            console.log('');
          }
        }
      } catch (error) {
        console.error(
          chalk.red(
            `Error: ${error instanceof Error ? error.message : String(error)}`
          )
        );
        process.exit(1);
      }
    }
  );

// --- serve ---
program
  .command('serve')
  .description('Start the Cortivex HTTP server')
  .option('-p, --port <port>', 'Server port (default: 3939)')
  .option('--mcp', 'Run as MCP server (stdio)')
  .action(async (options: { port?: string; mcp?: boolean }) => {
    const port = options.port ? parseInt(options.port, 10) : 3939;

    if (options.mcp) {
      console.log(
        chalk.cyan('  Starting Cortivex MCP server on stdio...')
      );
      // MCP server would read from stdin, write to stdout
      // Placeholder — the full MCP implementation would go here
      console.log(chalk.gray('  MCP server mode — awaiting requests'));
    } else {
      console.log('');
      console.log(
        chalk.bold.cyan(`  Starting Cortivex server on port ${port}...`)
      );
      console.log(
        chalk.gray(`  API: http://localhost:${port}/api/v1/`)
      );
      console.log(
        chalk.gray(`  Health: http://localhost:${port}/health`)
      );
      console.log('');
      console.log(
        chalk.gray('  Press Ctrl+C to stop.')
      );
      console.log('');

      // Keep process alive
      await new Promise(() => {
        // Server would be started here
      });
    }
  });

// --- ui ---
program
  .command('ui')
  .description('Start the Cortivex dashboard')
  .option('-p, --port <port>', 'Dashboard port (default: 4200)')
  .action(async (options: { port?: string }) => {
    const port = options.port ? parseInt(options.port, 10) : 4200;
    console.log('');
    console.log(
      chalk.bold.cyan(`  Starting Cortivex dashboard on port ${port}...`)
    );
    console.log(
      chalk.gray(`  Dashboard: http://localhost:${port}/`)
    );
    console.log('');
  });

// --- export ---
program
  .command('export <pipeline>')
  .description('Export a pipeline to another format')
  .option('-f, --format <format>', 'Export format: n8n, json, yaml (default: json)')
  .option('-o, --output <file>', 'Output file path')
  .action(
    async (
      pipelineName: string,
      options: { format?: string; output?: string }
    ) => {
      try {
        const cwd = process.cwd();
        const loader = new PipelineLoader(cwd);
        const pipeline = await loader.load(pipelineName);
        const format = options.format ?? 'json';

        let output: string;

        switch (format) {
          case 'json':
            output = JSON.stringify(pipeline, null, 2);
            break;
          case 'yaml': {
            const { stringify } = await import('yaml');
            output = stringify(pipeline);
            break;
          }
          case 'n8n':
            output = JSON.stringify(exportToN8nFormat(pipeline), null, 2);
            break;
          default:
            console.log(
              chalk.red(`  Unknown format: "${format}". Use json, yaml, or n8n.`)
            );
            process.exit(1);
        }

        if (options.output) {
          const { writeFile } = await import('node:fs/promises');
          await writeFile(options.output, output, 'utf-8');
          console.log(
            chalk.green(`  Exported "${pipelineName}" to ${options.output}`)
          );
        } else {
          console.log(output);
        }
      } catch (error) {
        console.error(
          chalk.red(
            `Error: ${error instanceof Error ? error.message : String(error)}`
          )
        );
        process.exit(1);
      }
    }
  );

// --- insights ---
program
  .command('insights')
  .description('Show learned patterns from past executions')
  .action(async () => {
    try {
      const cwd = process.cwd();

      // Show stats first
      const recorder = new HistoryRecorder(cwd);
      const stats = await recorder.getStats();

      console.log('');
      console.log(chalk.bold.cyan('  Execution History'));
      console.log(chalk.gray('  ' + '\u2500'.repeat(50)));
      console.log(
        `  Total runs:      ${chalk.white(String(stats.totalRuns))}`
      );
      console.log(
        `  Success rate:    ${chalk.white((stats.successRate * 100).toFixed(0) + '%')}`
      );
      console.log(
        `  Average cost:    ${chalk.white('$' + stats.averageCost.toFixed(3))}`
      );
      console.log(
        `  Total cost:      ${chalk.white('$' + stats.totalCost.toFixed(3))}`
      );
      console.log(
        `  Avg duration:    ${chalk.white(stats.averageDuration.toFixed(1) + 's')}`
      );
      console.log(
        `  Most used:       ${chalk.white(stats.mostUsedPipeline)}`
      );
      console.log(
        `  Most expensive:  ${chalk.white(stats.mostExpensiveNode)}`
      );
      console.log(
        `  Least reliable:  ${chalk.white(stats.leastReliableNode)}`
      );
      console.log('');

      // Show insights
      const extractor = new PatternExtractor(cwd);
      const insights = await extractor.analyze();

      if (insights.length === 0) {
        console.log(
          chalk.gray(
            '  No insights yet. Run more pipelines to generate patterns.'
          )
        );
        console.log(
          chalk.gray(
            `  Need at least 3 runs to start finding patterns.`
          )
        );
        console.log('');
        return;
      }

      console.log(chalk.bold.cyan('  Learned Insights'));
      console.log(chalk.gray('  ' + '\u2500'.repeat(50)));

      for (const insight of insights) {
        const confidenceColor =
          insight.confidence > 0.8
            ? chalk.green
            : insight.confidence > 0.5
              ? chalk.yellow
              : chalk.red;

        const actionIcon: Record<string, string> = {
          reorder: '\u21C5',
          substitute_model: '\u21BB',
          skip_node: '\u21B3',
          add_node: '+',
        };

        console.log('');
        console.log(
          `  ${actionIcon[insight.action] ?? '\u2022'} ${chalk.bold(insight.pattern)}`
        );
        console.log(
          chalk.gray(`    ${insight.description}`)
        );
        console.log(
          `    Confidence: ${confidenceColor((insight.confidence * 100).toFixed(0) + '%')} | Based on ${insight.basedOnRuns} runs | Action: ${insight.action}`
        );
      }

      console.log('');
    } catch (error) {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });

// --- mesh ---
program
  .command('mesh')
  .description('Show current mesh coordination state')
  .option('-c, --cleanup', 'Remove stale claims')
  .action(async (options: { cleanup?: boolean }) => {
    try {
      const cwd = process.cwd();
      const mesh = new MeshManager(cwd);

      if (options.cleanup) {
        const removed = await mesh.cleanup();
        console.log('');
        console.log(
          chalk.green(`  Cleaned up ${removed} stale claim(s).`)
        );
        console.log('');
        return;
      }

      const state = await mesh.query();

      console.log('');
      console.log(chalk.bold.cyan('  Mesh State'));
      console.log(chalk.gray('  ' + '\u2500'.repeat(50)));

      if (state.claims.length === 0) {
        console.log(
          chalk.gray('  No active claims. The mesh is clear.')
        );
      } else {
        console.log(
          `  Active claims: ${chalk.white(String(state.claims.length))}`
        );
        console.log('');

        for (const claim of state.claims) {
          console.log(
            `  ${chalk.blue('\u25cf')} ${chalk.bold(claim.agentId)}`
          );
          console.log(
            chalk.gray(
              `    Node: ${claim.nodeId} | Run: ${claim.pipelineRunId.slice(0, 8)}... | Status: ${claim.status}`
            )
          );
          console.log(
            chalk.gray(
              `    Files: ${claim.files.join(', ')}`
            )
          );
          console.log(
            chalk.gray(
              `    Claimed: ${claim.claimedAt} | Updated: ${claim.lastUpdate}`
            )
          );
        }
      }

      if (state.conflicts.length > 0) {
        console.log('');
        console.log(
          chalk.bold.red('  Conflicts')
        );
        for (const conflict of state.conflicts) {
          console.log(
            `  ${chalk.red('\u26A0')} "${conflict.file}" claimed by ${conflict.claimedBy}, requested by ${conflict.requestedBy}`
          );
        }
      }

      console.log('');
    } catch (error) {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });

// --- n8n export helper ---
function exportToN8nFormat(pipeline: {
  name: string;
  description: string;
  nodes: Array<{
    id: string;
    type: string;
    depends_on?: string[];
  }>;
}): object {
  const n8nNodes: Array<Record<string, unknown>> = [];
  const n8nConnections: Record<string, Record<string, Array<Array<Record<string, unknown>>>>> = {};

  let xPos = 250;
  const yPos = 300;
  const xSpacing = 250;

  // Start trigger
  n8nNodes.push({
    parameters: {},
    id: 'trigger',
    name: 'Manual Trigger',
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: [0, yPos],
  });

  for (const node of pipeline.nodes) {
    const nodeType = nodeRegistry.get(node.type);

    n8nNodes.push({
      parameters: {
        url: `http://localhost:3939/api/v1/execute/${node.id}`,
        method: 'POST',
        sendBody: true,
        bodyParameters: {
          parameters: [
            {
              name: 'nodeType',
              value: node.type,
            },
            {
              name: 'pipeline',
              value: pipeline.name,
            },
          ],
        },
      },
      id: node.id,
      name: nodeType?.name ?? node.id,
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4,
      position: [xPos, yPos],
    });

    xPos += xSpacing;

    // Add connections
    if (node.depends_on && node.depends_on.length > 0) {
      for (const dep of node.depends_on) {
        if (!n8nConnections[dep]) {
          n8nConnections[dep] = { main: [[]] };
        }
        n8nConnections[dep]['main'][0].push({
          node: nodeType?.name ?? node.id,
          type: 'main',
          index: 0,
        });
      }
    } else {
      // Connect to trigger
      if (!n8nConnections['Manual Trigger']) {
        n8nConnections['Manual Trigger'] = { main: [[]] };
      }
      n8nConnections['Manual Trigger']['main'][0].push({
        node: nodeType?.name ?? node.id,
        type: 'main',
        index: 0,
      });
    }
  }

  return {
    name: `Cortivex: ${pipeline.name}`,
    nodes: n8nNodes,
    connections: n8nConnections,
    active: false,
    settings: {},
    tags: ['cortivex'],
  };
}

// --- status ---
program
  .command('status [runId]')
  .description('Show the status of a pipeline run')
  .action(async (runId?: string) => {
    try {
      const cwd = process.cwd();
      const recorder = new HistoryRecorder(cwd);
      const runs = await recorder.getRuns();

      if (runs.length === 0) {
        console.log('');
        console.log(
          chalk.gray('  No pipeline runs found. Run a pipeline first with "cortivex run <pipeline>".')
        );
        console.log('');
        return;
      }

      const run = runId
        ? runs.find((r) => r.id === runId || r.id.startsWith(runId))
        : runs[0];

      if (!run) {
        console.log('');
        console.log(
          chalk.red(`  Run "${runId}" not found.`)
        );
        console.log('');
        process.exit(1);
      }

      const statusStr = run.success ? 'success' : 'failed';
      const statusColor = run.success ? chalk.green : chalk.red;

      console.log('');
      console.log(chalk.bold.cyan('  Pipeline Run Status'));
      console.log(chalk.gray('  ' + '\u2500'.repeat(50)));
      console.log(
        `  Run ID:       ${chalk.white(run.id)}`
      );
      console.log(
        `  Pipeline:     ${chalk.white(run.pipeline)}`
      );
      console.log(
        `  Status:       ${statusColor(statusStr)}`
      );
      console.log(
        `  Duration:     ${chalk.white(run.totalDuration.toFixed(1) + 's')}`
      );
      console.log(
        `  Cost:         ${chalk.white('$' + run.totalCost.toFixed(3))}`
      );
      console.log('');

      if (run.nodeResults && run.nodeResults.length > 0) {
        console.log(chalk.bold.cyan('  Node Outcomes'));
        console.log(chalk.gray('  ' + '\u2500'.repeat(50)));
        for (const result of run.nodeResults) {
          const nodeStatusStr = result.success ? 'success' : 'failed';
          const nodeStatusColor = result.success ? chalk.green : chalk.red;
          console.log(
            `  ${nodeStatusColor('\u25cf')} ${chalk.white(result.nodeId)} ${chalk.gray('—')} ${nodeStatusColor(nodeStatusStr)} ${chalk.gray('(' + result.duration.toFixed(1) + 's, $' + result.cost.toFixed(3) + ')')}`
          );
        }
        console.log('');
      }
    } catch (error) {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });

// --- stop ---
program
  .command('stop <runId>')
  .description('Send a stop signal to a running pipeline')
  .action(async (runId: string) => {
    try {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { join } = await import('node:path');

      const cwd = process.cwd();

      // Verify the run exists in history
      const recorder = new HistoryRecorder(cwd);
      const run = await recorder.getRunById(runId);
      if (!run) {
        console.log('');
        console.error(
          chalk.red(`  Error: No run found with ID "${runId}".`)
        );
        console.log('');
        process.exit(1);
      }

      // Create the signals directory if it doesn't exist
      const signalsDir = join(cwd, '.cortivex', 'signals');
      await mkdir(signalsDir, { recursive: true });

      // Write the stop signal file
      const signalFile = join(signalsDir, `stop-${runId}.json`);
      await writeFile(
        signalFile,
        JSON.stringify(
          { runId, signal: 'stop', timestamp: new Date().toISOString() },
          null,
          2
        ),
        'utf-8'
      );

      console.log('');
      console.log(
        chalk.yellow(`  Stop signal sent to run "${runId}".`)
      );
      console.log(
        chalk.gray('  The pipeline will halt after the current node completes.')
      );
      console.log('');
    } catch (error) {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });

// --- install-skills ---
program
  .command('install-skills')
  .description('Install Cortivex skills into the current project')
  .action(async () => {
    try {
      const { readdir, mkdir, copyFile } = await import('node:fs/promises');
      const { join, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');

      const cwd = process.cwd();
      const __filename = fileURLToPath(import.meta.url);
      const packageRoot = join(dirname(__filename), '..', '..', '..');
      const sourceDir = join(packageRoot, '.agents', 'skills');
      const targetDir = join(cwd, '.agents', 'skills');

      // Ensure target directory exists
      await mkdir(targetDir, { recursive: true });

      const entries = await readdir(sourceDir, { withFileTypes: true });
      let count = 0;

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillSource = join(sourceDir, entry.name);
          const skillTarget = join(targetDir, entry.name);
          await mkdir(skillTarget, { recursive: true });

          const files = await readdir(skillSource);
          for (const file of files) {
            await copyFile(
              join(skillSource, file),
              join(skillTarget, file)
            );
          }
          count++;
        }
      }

      console.log('');
      console.log(
        chalk.green(`  Installed ${count} skill(s) into .agents/skills/`)
      );
      console.log(
        chalk.gray('  Skills will activate automatically in Claude Code based on context.')
      );
      console.log('');
    } catch (error) {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });

program.parse();
