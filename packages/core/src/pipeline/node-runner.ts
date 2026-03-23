import { spawn } from 'node:child_process';
import type { NodeDefinition, NodeRunState, NodeType, StreamMessage } from '../types.js';
import { nodeRegistry } from '../nodes/registry.js';
import { EventEmitter } from 'eventemitter3';

export interface NodeRunContext {
  runId: string;
  targetDir: string;
  previousOutputs: Map<string, string>;
  model?: string;
  verbose?: boolean;
}

interface NodeRunnerEvents {
  progress: (nodeId: string, progress: number, message: string) => void;
  output: (nodeId: string, text: string) => void;
  cost: (nodeId: string, cost: number, tokens: number) => void;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export class NodeRunner extends EventEmitter<NodeRunnerEvents> {
  private readonly timeout: number;

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    super();
    this.timeout = timeoutMs;
  }

  async run(
    node: NodeDefinition,
    context: NodeRunContext
  ): Promise<NodeRunState> {
    const nodeType = nodeRegistry.getOrThrow(node.type);
    const startedAt = new Date().toISOString();

    const state: NodeRunState = {
      nodeId: node.id,
      status: 'running',
      startedAt,
      progress: 0,
      cost: 0,
      tokens: 0,
      output: '',
      filesModified: [],
    };

    try {
      this.emit('progress', node.id, 0, `Starting ${nodeType.name}...`);

      // Determine whether to use heavy (Claude CLI) or light (API) or shell node
      const isShellNode = node.type === 'test-runner' || node.type === 'lint-fixer';
      const isLightNode = this.isLightNode(nodeType);

      let result: NodeExecutionResult;
      if (isShellNode && node.config?.['shellOnly']) {
        result = await this.runShellNode(node, nodeType, context);
      } else if (isLightNode) {
        result = await this.runLightNode(node, nodeType, context);
      } else {
        result = await this.runHeavyNode(node, nodeType, context);
      }

      state.status = 'completed';
      state.completedAt = new Date().toISOString();
      state.progress = 100;
      state.cost = result.cost;
      state.tokens = result.tokens;
      state.output = result.output;
      state.filesModified = result.filesModified;

      this.emit('progress', node.id, 100, `${nodeType.name} completed`);
      this.emit('cost', node.id, result.cost, result.tokens);

      return state;
    } catch (error) {
      state.status = 'failed';
      state.completedAt = new Date().toISOString();
      state.error =
        error instanceof Error ? error.message : String(error);
      state.progress = 0;

      return state;
    }
  }

  private isLightNode(nodeType: NodeType): boolean {
    // Light nodes use the Anthropic API directly — faster, cheaper, but no tool use
    // Heavy nodes use Claude CLI — supports tools, file access, etc.
    return nodeType.defaultModel.includes('haiku') && nodeType.tools.length <= 3;
  }

  async runHeavyNode(
    node: NodeDefinition,
    nodeType: NodeType,
    context: NodeRunContext
  ): Promise<NodeExecutionResult> {
    const model = context.model ?? nodeType.defaultModel;
    const prompt = this.buildPrompt(node, nodeType, context);

    return new Promise<NodeExecutionResult>((resolve, reject) => {
      const args = [
        '--print',
        '--output-format', 'json',
        '--model', model,
        '--no-session-persistence',
        '-p', prompt,
      ];

      // Add allowedTools if specified
      if (nodeType.tools.length > 0) {
        args.push('--allowedTools', nodeType.tools.join(','));
      }

      // Add max budget to prevent runaway costs
      args.push('--max-budget-usd', '2');

      const child = spawn('claude', args, {
        cwd: context.targetDir,
        env: { ...process.env },
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let fullOutput = '';
      const filesModified: string[] = [];

      const timeoutTimer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Node "${node.id}" timed out after ${this.timeout / 1000}s`));
      }, this.timeout);

      // Emit progress periodically while running
      const progressTimer = setInterval(() => {
        this.emit('progress', node.id, 50, 'Claude agent working...');
      }, 3000);

      child.stdout.on('data', (data: Buffer) => {
        fullOutput += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        if (context.verbose) {
          this.emit('output', node.id, `[stderr] ${text}`);
        }
      });

      child.on('close', (code) => {
        clearTimeout(timeoutTimer);
        clearInterval(progressTimer);

        // Parse the JSON result from stdout
        let totalCost = 0;
        let totalTokens = 0;
        let resultText = '';

        // Find the last JSON object in stdout (the result)
        const lines = fullOutput.split('\n').filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i]);
            if (parsed.type === 'result') {
              resultText = parsed.result || '';
              totalCost = parsed.total_cost_usd || 0;
              // Sum up tokens from usage
              const usage = parsed.usage || {};
              totalTokens = (usage.input_tokens || 0) +
                (usage.output_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0);
              break;
            }
          } catch {
            // Not JSON, skip
          }
        }

        if (code !== 0 && code !== null && !resultText) {
          reject(
            new Error(
              `Claude CLI exited with code ${code} for node "${node.id}".\nOutput: ${fullOutput.slice(0, 500)}`
            )
          );
          return;
        }

        // Extract modified files from output
        const filePattern = /(?:modified|created|updated|wrote|edited)\s+(?:file\s+)?["`']?([^\s"`']+\.\w+)["`']?/gi;
        let match: RegExpExecArray | null;
        while ((match = filePattern.exec(resultText || fullOutput)) !== null) {
          if (match[1] && !filesModified.includes(match[1])) {
            filesModified.push(match[1]);
          }
        }

        resolve({
          output: resultText || fullOutput,
          cost: totalCost,
          tokens: totalTokens,
          filesModified,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timeoutTimer);
        clearInterval(progressTimer);
        reject(
          new Error(
            `Failed to spawn Claude CLI for node "${node.id}": ${err.message}. ` +
            `Ensure Claude CLI is installed and available in PATH.`
          )
        );
      });
    });
  }

  async runLightNode(
    node: NodeDefinition,
    nodeType: NodeType,
    context: NodeRunContext
  ): Promise<NodeExecutionResult> {
    const model = context.model ?? nodeType.defaultModel;
    const prompt = this.buildPrompt(node, nodeType, context);

    // Use Claude CLI in non-streaming mode for light nodes
    return new Promise<NodeExecutionResult>((resolve, reject) => {
      const args = ['--print', '--output-format', 'json', '--model', model, '-p', prompt];

      const child = spawn('claude', args, {
        cwd: context.targetDir,
        env: { ...process.env },
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      const timeoutTimer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Light node "${node.id}" timed out after ${this.timeout / 1000}s`));
      }, this.timeout);

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeoutTimer);

        if (code !== 0 && code !== null) {
          reject(
            new Error(
              `Light node "${node.id}" failed (exit code ${code}): ${stderr.slice(0, 500)}`
            )
          );
          return;
        }

        // Parse the JSON result from stdout (same logic as runHeavyNode)
        let totalCost = 0;
        let totalTokens = 0;
        let resultText = '';

        const lines = stdout.split('\n').filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i]);
            if (parsed.type === 'result') {
              resultText = parsed.result || '';
              totalCost = parsed.total_cost_usd || 0;
              const usage = parsed.usage || {};
              totalTokens = (usage.input_tokens || 0) +
                (usage.output_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0);
              break;
            }
          } catch {
            // Not JSON, skip
          }
        }

        this.emit('progress', node.id, 100, 'Done');
        resolve({
          output: resultText || stdout,
          cost: totalCost,
          tokens: totalTokens,
          filesModified: [],
        });
      });

      child.on('error', (err) => {
        clearTimeout(timeoutTimer);
        reject(new Error(`Failed to run light node "${node.id}": ${err.message}`));
      });
    });
  }

  async runShellNode(
    node: NodeDefinition,
    nodeType: NodeType,
    context: NodeRunContext
  ): Promise<NodeExecutionResult> {
    const command = node.config?.['command'] as string | undefined;
    if (!command) {
      throw new Error(`Shell node "${node.id}" requires a "command" in its config.`);
    }

    return new Promise<NodeExecutionResult>((resolve, reject) => {
      const child = spawn(command, {
        cwd: context.targetDir,
        env: { ...process.env },
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      const timeoutTimer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Shell node "${node.id}" timed out after ${this.timeout / 1000}s`));
      }, this.timeout);

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        this.emit('output', node.id, text);
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeoutTimer);

        resolve({
          output: stdout + (stderr ? `\n[stderr]\n${stderr}` : ''),
          cost: 0,
          tokens: 0,
          filesModified: [],
        });
      });

      child.on('error', (err) => {
        clearTimeout(timeoutTimer);
        reject(new Error(`Shell node "${node.id}" failed: ${err.message}`));
      });
    });
  }

  private buildPrompt(
    node: NodeDefinition,
    nodeType: NodeType,
    context: NodeRunContext
  ): string {
    const parts: string[] = [];

    // System prompt
    parts.push(nodeType.systemPrompt);

    // Add context from previous node outputs
    if (node.depends_on && node.depends_on.length > 0) {
      const previousResults: string[] = [];
      for (const depId of node.depends_on) {
        const output = context.previousOutputs.get(depId);
        if (output) {
          previousResults.push(
            `--- Output from "${depId}" ---\n${output.slice(0, 4000)}\n--- End of "${depId}" output ---`
          );
        }
      }
      if (previousResults.length > 0) {
        parts.push(
          '\n\n## Previous Node Outputs\nThe following outputs are from nodes that ran before this one:\n\n' +
          previousResults.join('\n\n')
        );
      }
    }

    // Add node-specific config
    if (node.config) {
      parts.push(
        '\n\n## Additional Configuration\n' +
        JSON.stringify(node.config, null, 2)
      );
    }

    // Add target directory context
    parts.push(
      `\n\n## Working Directory\nThe project is located at: ${context.targetDir}\nAnalyze and modify files within this directory.`
    );

    return parts.join('\n');
  }

  private handleStreamMessage(
    nodeId: string,
    msg: StreamMessage,
    handlers: {
      onText: (text: string) => void;
      onProgress: (progress: number) => void;
      onResult: (cost: number, tokens: number) => void;
    }
  ): void {
    switch (msg.type) {
      case 'content_block_delta':
        if (msg.delta?.text) {
          handlers.onText(msg.delta.text);
        }
        break;

      case 'content_block_start':
        if (msg.content_block?.text) {
          handlers.onText(msg.content_block.text);
        }
        break;

      case 'message_delta':
        // Estimate progress based on message flow
        handlers.onProgress(50);
        break;

      case 'result':
        if (msg.result) {
          const cost = msg.result.cost_usd ?? 0;
          const tokens =
            (msg.result.input_tokens ?? 0) + (msg.result.output_tokens ?? 0);
          handlers.onResult(cost, tokens);
        }
        handlers.onProgress(100);
        break;
    }
  }
}

interface NodeExecutionResult {
  output: string;
  cost: number;
  tokens: number;
  filesModified: string[];
}
