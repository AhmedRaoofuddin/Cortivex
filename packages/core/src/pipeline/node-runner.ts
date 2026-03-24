import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import type { NodeDefinition, NodeRunState, NodeType, StreamMessage } from '../types.js';
import { nodeRegistry } from '../nodes/registry.js';
import { EventEmitter } from 'eventemitter3';

// On Windows, .cmd scripts cannot be spawned with shell:false.
// Instead, we spawn cmd.exe /c claude [...args] which works with shell:false.
const IS_WINDOWS = platform() === 'win32';
const CLAUDE_CMD = IS_WINDOWS ? (process.env.ComSpec ?? 'cmd.exe') : 'claude';

/** Prepend /c claude to args on Windows so cmd.exe runs the .cmd script */
function claudeArgs(args: string[]): string[] {
  return IS_WINDOWS ? ['/c', 'claude', ...args] : args;
}

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
    const model = this.sanitizeModel(context.model ?? nodeType.defaultModel);
    const prompt = this.buildPrompt(node, nodeType, context);

    return new Promise<NodeExecutionResult>((resolve, reject) => {
      const args = [
        '--print',
        '--output-format', 'json',
        '--model', model,
        '--no-session-persistence',
        '--max-budget-usd', '2',
      ];

      // Add allowedTools if specified (validate tool names)
      if (nodeType.tools.length > 0) {
        const sanitizedTools = nodeType.tools.map(tool => this.sanitizeToolName(tool));
        args.push('--allowedTools', sanitizedTools.join(','));
      }

      // Use stdin to pipe the prompt instead of -p flag.
      // Long prompts with special characters get mangled by Windows shell
      // when passed as command-line args with shell:true.
      // Use shell:false with cmd.exe /c on Windows to prevent injection
      const child = spawn(CLAUDE_CMD, claudeArgs(args), {
        cwd: context.targetDir,
        env: { ...process.env },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Write prompt to stdin and close it — Claude CLI reads from stdin
      child.stdin.write(prompt);
      child.stdin.end();

      let fullOutput = '';
      const filesModified: string[] = [];
      let lineCount = 0;

      let isResolved = false;
      const cleanup = () => {
        if (child) {
          child.removeAllListeners();
        }
        clearTimeout(timeoutTimer);
      };

      const timeoutTimer = setTimeout(() => {
        if (!isResolved && child && !child.killed) {
          child.kill('SIGTERM');
          isResolved = true;
          cleanup();
          reject(new Error(`Node "${node.id}" timed out after ${this.timeout / 1000}s`));
        }
      }, this.timeout);

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        fullOutput += text;

        // Parse streaming JSON lines for real-time progress
        const lines = text.split('\n').filter(Boolean);
        for (const line of lines) {
          lineCount++;
          try {
            const msg = JSON.parse(line);
            // Real Claude CLI streaming events
            if (msg.type === 'assistant' && msg.message?.content) {
              for (const block of msg.message.content) {
                if (block.type === 'text' && block.text) {
                  const preview = block.text.substring(0, 120).replace(/\n/g, ' ');
                  this.emit('progress', node.id, Math.min(90, lineCount * 5), preview);
                } else if (block.type === 'tool_use') {
                  this.emit('progress', node.id, Math.min(90, lineCount * 5),
                    `Using ${block.name}: ${JSON.stringify(block.input).substring(0, 80)}`);
                }
              }
            } else if (msg.type === 'tool_result' || msg.type === 'tool_output') {
              this.emit('progress', node.id, Math.min(90, lineCount * 5), 'Processing tool result...');
            } else if (msg.type === 'result') {
              // Final result — extract cost/tokens immediately
              this.emit('progress', node.id, 95, 'Finalizing...');
            }
          } catch {
            // Not JSON — might be raw text output
            const trimmed = text.trim();
            if (trimmed.length > 0 && trimmed.length < 200) {
              this.emit('progress', node.id, Math.min(90, lineCount * 5), trimmed);
            }
          }
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          this.emit('output', node.id, `[stderr] ${text}`);
        }
      });

      child.on('close', (code) => {
        if (isResolved) return;
        isResolved = true;
        cleanup();

        // Parse the JSON result from stdout
        let totalCost = 0;
        let totalTokens = 0;
        let resultText = '';

        // Find ALL JSON objects in stdout — look for "type":"result" anywhere
        // Claude CLI may output multiple JSON lines (tool calls + final result)
        // or a single JSON blob. Handle both cases.
        const lines = fullOutput.split('\n').filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i]);
            if (parsed.type === 'result') {
              resultText = parsed.result || parsed.text || '';
              totalCost = parsed.total_cost_usd ?? parsed.cost_usd ?? 0;
              // Sum up tokens from usage (multiple possible formats)
              const usage = parsed.usage || {};
              totalTokens = (usage.input_tokens || 0) +
                (usage.output_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0);
              break;
            }
          } catch {
            // Not JSON — try to find JSON embedded in the line
            const jsonMatch = lines[i].match(/\{.*"type"\s*:\s*"result".*\}/);
            if (jsonMatch) {
              try {
                const parsed = JSON.parse(jsonMatch[0]);
                resultText = parsed.result || '';
                totalCost = parsed.total_cost_usd ?? 0;
                const usage = parsed.usage || {};
                totalTokens = (usage.input_tokens || 0) +
                  (usage.output_tokens || 0) +
                  (usage.cache_read_input_tokens || 0) +
                  (usage.cache_creation_input_tokens || 0);
                break;
              } catch { /* skip */ }
            }
          }
        }

        // Fallback: if we didn't find a result JSON but have output, use raw text
        if (!resultText && fullOutput.trim()) {
          resultText = fullOutput.trim().substring(0, 10000);
        }

        if (code !== 0 && code !== null && !resultText) {
          // Log detailed error for debugging but return generic message
          console.error(`Node execution failed - Code: ${code}, Node: ${node.id}, Output: ${fullOutput.slice(0, 500)}`);
          reject(new Error(`Node execution failed with exit code ${code}`));
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
        if (isResolved) return;
        isResolved = true;
        cleanup();
        // Log detailed error for debugging but return generic message
        console.error(`Failed to spawn process for node "${node.id}": ${err.message}`);
        reject(new Error('Failed to execute node - ensure required tools are installed'));
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
      const sanitizedModel = this.sanitizeModel(model);
      const args = ['--print', '--output-format', 'json', '--model', sanitizedModel];

      const child = spawn(CLAUDE_CMD, claudeArgs(args), {
        cwd: context.targetDir,
        env: { ...process.env },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Pipe prompt via stdin to avoid shell escaping issues
      child.stdin.write(prompt);
      child.stdin.end();

      let stdout = '';
      let stderr = '';

      let isResolved = false;
      const cleanup = () => {
        if (child) {
          child.removeAllListeners();
        }
        clearTimeout(timeoutTimer);
      };

      const timeoutTimer = setTimeout(() => {
        if (!isResolved && child && !child.killed) {
          child.kill('SIGTERM');
          isResolved = true;
          cleanup();
          reject(new Error(`Light node "${node.id}" timed out after ${this.timeout / 1000}s`));
        }
      }, this.timeout);

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (isResolved) return;
        isResolved = true;
        cleanup();

        if (code !== 0 && code !== null) {
          // Log detailed error for debugging but return generic message
          console.error(`Light node execution failed - Code: ${code}, Node: ${node.id}, Error: ${stderr.slice(0, 500)}`);
          reject(new Error(`Light node execution failed with exit code ${code}`));
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
              resultText = parsed.result || parsed.text || '';
              totalCost = parsed.total_cost_usd ?? parsed.cost_usd ?? 0;
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

        if (!resultText && stdout.trim()) {
          resultText = stdout.trim().substring(0, 10000);
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
        if (isResolved) return;
        isResolved = true;
        cleanup();
        // Log detailed error for debugging but return generic message
        console.error(`Failed to run light node "${node.id}": ${err.message}`);
        reject(new Error('Light node execution failed'));
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

    // Validate and sanitize command to prevent shell injection
    const sanitizedCommand = this.sanitizeCommand(command);
    const { executable, args } = this.parseCommand(sanitizedCommand);

    return new Promise<NodeExecutionResult>((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: context.targetDir,
        env: { ...process.env },
        shell: false, // Disable shell to prevent injection
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      let isResolved = false;
      const cleanup = () => {
        if (child) {
          child.removeAllListeners();
        }
        clearTimeout(timeoutTimer);
      };

      const timeoutTimer = setTimeout(() => {
        if (!isResolved && child && !child.killed) {
          child.kill('SIGTERM');
          isResolved = true;
          cleanup();
          reject(new Error(`Shell node "${node.id}" timed out after ${this.timeout / 1000}s`));
        }
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
        if (isResolved) return;
        isResolved = true;
        cleanup();

        resolve({
          output: stdout + (stderr ? `\n[stderr]\n${stderr}` : ''),
          cost: 0,
          tokens: 0,
          filesModified: [],
        });
      });

      child.on('error', (err) => {
        if (isResolved) return;
        isResolved = true;
        cleanup();
        // Log detailed error for debugging but return generic message
        console.error(`Shell node "${node.id}" failed: ${err.message}`);
        reject(new Error('Shell node execution failed'));
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

  private sanitizeCommand(command: string): string {
    // Remove dangerous characters and patterns that could be used for injection
    const dangerous = /[;&|`$(){}[\]<>]/g;
    if (dangerous.test(command)) {
      throw new Error('Command contains potentially dangerous characters: ' + command);
    }

    // Trim whitespace and validate non-empty
    const trimmed = command.trim();
    if (!trimmed) {
      throw new Error('Empty command provided');
    }

    return trimmed;
  }

  private parseCommand(command: string): { executable: string; args: string[] } {
    // Split on whitespace while preserving quoted strings
    const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    if (parts.length === 0) {
      throw new Error('Invalid command format');
    }

    const executable = parts[0]!.replace(/"/g, ''); // Remove quotes from executable
    const args = parts.slice(1).map(arg => arg.replace(/"/g, '')); // Remove quotes from args

    // Validate executable name (allow only alphanumeric, dash, underscore, dot)
    if (!/^[\w.-]+$/.test(executable)) {
      throw new Error(`Invalid executable name: ${executable}`);
    }

    return { executable, args };
  }

  private sanitizeModel(model: string): string {
    // Validate model name against allowed patterns to prevent injection
    const allowedModelPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
    if (!allowedModelPattern.test(model)) {
      throw new Error(`Invalid model name: ${model}. Model names must contain only alphanumeric characters, dots, underscores, and hyphens.`);
    }
    // 64 char limit is reasonable for model identifiers (e.g., "claude-opus-4-6-2026-03-24-trial")
    if (model.length > 64) {
      throw new Error(`Model name too long: ${model}. Maximum length is 64 characters.`);
    }
    return model;
  }

  private sanitizeToolName(tool: string): string {
    // Validate tool name against allowed patterns to prevent injection
    const allowedToolPattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
    if (!allowedToolPattern.test(tool)) {
      throw new Error(`Invalid tool name: ${tool}. Tool names must start with a letter and contain only alphanumeric characters, underscores, and hyphens.`);
    }
    // 32 char limit is reasonable for tool identifiers (e.g., "custom-async-file-processor-v2")
    if (tool.length > 32) {
      throw new Error(`Tool name too long: ${tool}. Maximum length is 32 characters.`);
    }
    return tool;
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
