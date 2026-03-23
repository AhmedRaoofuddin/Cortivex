import { v4 as uuidv4 } from 'uuid';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'eventemitter3';
import type {
  PipelineDefinition,
  PipelineRun,
  NodeRunState,
  ExecuteOptions,
  NodeDefinition,
  NodeType,
} from '../types.js';
import { NodeRunner } from './node-runner.js';
import { MeshManager } from '../mesh/manager.js';
import { HistoryRecorder } from '../learning/recorder.js';
import { nodeRegistry } from '../nodes/registry.js';

export interface ExecutorEvents {
  'node:start': (nodeId: string, nodeType: string) => void;
  'node:progress': (nodeId: string, progress: number, message: string) => void;
  'node:complete': (nodeId: string, state: NodeRunState) => void;
  'node:failed': (nodeId: string, error: string) => void;
  'pipeline:start': (runId: string, pipeline: string) => void;
  'pipeline:complete': (run: PipelineRun) => void;
  'pipeline:failed': (run: PipelineRun, error: string) => void;
  'mesh:claim': (agentId: string, files: string[]) => void;
  'mesh:conflict': (file: string, claimedBy: string) => void;
  'mesh:release': (agentId: string) => void;
}

export class PipelineExecutor extends EventEmitter<ExecutorEvents> {
  private readonly runner: NodeRunner;
  private readonly mesh: MeshManager;
  private readonly recorder: HistoryRecorder;

  constructor(baseDir: string = process.cwd()) {
    super();
    this.runner = new NodeRunner();
    this.mesh = new MeshManager(baseDir);
    this.recorder = new HistoryRecorder(baseDir);

    // Forward runner events
    this.runner.on('progress', (nodeId, progress, message) => {
      this.emit('node:progress', nodeId, progress, message);
    });
  }

  async execute(
    pipeline: PipelineDefinition,
    options: ExecuteOptions = {}
  ): Promise<PipelineRun> {
    const runId = uuidv4();
    const {
      failureStrategy = 'stop',
      maxRetries = 1,
      parallelism = 4,
      verbose = false,
      targetDir = process.cwd(),
      model,
    } = options;

    // Initialize run state
    const run: PipelineRun = {
      id: runId,
      pipeline: pipeline.name,
      status: 'running',
      startedAt: new Date().toISOString(),
      nodes: pipeline.nodes.map((n) => ({
        nodeId: n.id,
        status: 'pending',
        progress: 0,
        cost: 0,
        tokens: 0,
        output: '',
        filesModified: [],
      })),
      totalCost: 0,
      totalTokens: 0,
      filesModified: [],
    };

    this.emit('pipeline:start', runId, pipeline.name);

    if (options.dryRun) {
      return this.dryRun(pipeline, run);
    }

    // Clean up stale mesh claims
    await this.mesh.cleanup();

    try {
      // Resolve execution order (topological sort)
      const executionOrder = this.resolveExecutionOrder(pipeline.nodes);
      const nodeOutputs = new Map<string, string>();
      const completedNodes = new Set<string>();
      let aborted = false;

      // Execute nodes in dependency order with parallelism
      for (const batch of executionOrder) {
        if (aborted) break;

        // Limit concurrent execution
        const batchChunks = this.chunkArray(batch, parallelism);

        for (const chunk of batchChunks) {
          if (aborted) break;

          const promises = chunk.map(async (node) => {
            // Check if we should skip due to failed dependency (in stop mode)
            if (failureStrategy === 'stop') {
              const hasFailedDep = (node.depends_on ?? []).some((depId) => {
                const depState = run.nodes.find((n) => n.nodeId === depId);
                return depState?.status === 'failed';
              });
              if (hasFailedDep) {
                const nodeState = run.nodes.find((n) => n.nodeId === node.id);
                if (nodeState) {
                  nodeState.status = 'skipped';
                  nodeState.output = 'Skipped due to failed dependency';
                }
                return;
              }
            }

            // Evaluate condition
            if (
              node.condition &&
              !this.evaluateCondition(node.condition, completedNodes, run)
            ) {
              const nodeState = run.nodes.find((n) => n.nodeId === node.id);
              if (nodeState) {
                nodeState.status = 'skipped';
                nodeState.output = `Condition not met: ${node.condition}`;
              }
              return;
            }

            await this.executeNode(
              node,
              run,
              {
                runId,
                targetDir,
                previousOutputs: nodeOutputs,
                model,
                verbose,
              },
              maxRetries
            );

            const nodeState = run.nodes.find((n) => n.nodeId === node.id);
            if (nodeState) {
              if (nodeState.status === 'completed') {
                completedNodes.add(node.id);
                nodeOutputs.set(node.id, nodeState.output);
              }
              run.totalCost += nodeState.cost;
              run.totalTokens += nodeState.tokens;
              run.filesModified.push(...nodeState.filesModified);
            }
          });

          await Promise.all(promises);

          // Check if we should abort
          if (failureStrategy === 'stop') {
            const hasFailed = run.nodes.some((n) => n.status === 'failed');
            if (hasFailed) {
              aborted = true;
            }
          }

          // Check for external stop signal
          if (!aborted && (await this.checkStopSignal(runId))) {
            aborted = true;
          }
        }
      }

      // Mark remaining pending nodes as skipped if we aborted
      if (aborted) {
        for (const nodeState of run.nodes) {
          if (nodeState.status === 'pending') {
            nodeState.status = 'skipped';
            nodeState.output = 'Skipped due to pipeline abort';
          }
        }
      }

      // Determine final status
      const hasFailed = run.nodes.some((n) => n.status === 'failed');
      run.status = hasFailed ? 'failed' : 'completed';
      run.completedAt = new Date().toISOString();

      // Deduplicate files modified
      run.filesModified = [...new Set(run.filesModified)];

      // Record history
      await this.recorder.record(run);

      // Clean up stop signal file if it exists
      await this.cleanupStopSignal(runId);

      if (run.status === 'completed') {
        this.emit('pipeline:complete', run);
      } else {
        const failedNodes = run.nodes
          .filter((n) => n.status === 'failed')
          .map((n) => `${n.nodeId}: ${n.error}`)
          .join('; ');
        this.emit('pipeline:failed', run, failedNodes);
      }

      return run;
    } catch (error) {
      run.status = 'failed';
      run.completedAt = new Date().toISOString();

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.emit('pipeline:failed', run, errorMessage);

      // Still record the failed run
      try {
        await this.recorder.record(run);
      } catch {
        // Ignore recording errors
      }

      return run;
    }
  }

  private async executeNode(
    node: NodeDefinition,
    run: PipelineRun,
    context: {
      runId: string;
      targetDir: string;
      previousOutputs: Map<string, string>;
      model?: string;
      verbose?: boolean;
    },
    maxRetries: number
  ): Promise<void> {
    const nodeState = run.nodes.find((n) => n.nodeId === node.id);
    if (!nodeState) return;

    const nodeType = nodeRegistry.get(node.type);
    const agentId = `${context.runId}-${node.id}`;

    this.emit('node:start', node.id, node.type);
    nodeState.status = 'running';
    nodeState.startedAt = new Date().toISOString();

    // Claim files in mesh
    const filesToClaim = this.getFilesForNode(nodeType);
    if (filesToClaim.length > 0) {
      const conflict = await this.mesh.checkConflict(filesToClaim);
      if (conflict) {
        this.emit('mesh:conflict', conflict.file, conflict.claimedBy);
        // Wait briefly and retry
        await this.delay(2000);
        const retryConflict = await this.mesh.checkConflict(filesToClaim);
        if (retryConflict) {
          nodeState.status = 'failed';
          nodeState.error = `File conflict: "${retryConflict.file}" is claimed by agent "${retryConflict.claimedBy}"`;
          nodeState.completedAt = new Date().toISOString();
          this.emit('node:failed', node.id, nodeState.error);
          return;
        }
      }

      await this.mesh.claim(agentId, node.id, context.runId, filesToClaim);
      this.emit('mesh:claim', agentId, filesToClaim);
    }

    let lastError: string | undefined;
    let attempts = 0;

    while (attempts < maxRetries) {
      attempts++;

      const result = await this.runner.run(node, context);

      if (result.status === 'completed') {
        nodeState.status = 'completed';
        nodeState.completedAt = result.completedAt;
        nodeState.progress = 100;
        nodeState.cost = result.cost;
        nodeState.tokens = result.tokens;
        nodeState.output = result.output;
        nodeState.filesModified = result.filesModified;

        if (filesToClaim.length > 0) {
          await this.mesh.release(agentId);
          this.emit('mesh:release', agentId);
        }
        this.emit('node:complete', node.id, nodeState);
        return;
      }

      lastError = result.error;

      if (attempts < maxRetries) {
        // Wait before retry with exponential backoff
        await this.delay(1000 * Math.pow(2, attempts - 1));
      }
    }

    // All retries exhausted
    nodeState.status = 'failed';
    nodeState.completedAt = new Date().toISOString();
    nodeState.error = lastError ?? 'Unknown error';

    if (filesToClaim.length > 0) {
      await this.mesh.release(agentId);
      this.emit('mesh:release', agentId);
    }
    this.emit('node:failed', node.id, nodeState.error);
  }

  /**
   * Resolves execution order from the DAG using topological sort.
   * Returns batches of nodes that can be executed in parallel.
   */
  resolveExecutionOrder(nodes: NodeDefinition[]): NodeDefinition[][] {
    const nodeMap = new Map<string, NodeDefinition>();
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const node of nodes) {
      nodeMap.set(node.id, node);
      inDegree.set(node.id, 0);
      dependents.set(node.id, []);
    }

    // Build in-degree and dependents maps
    for (const node of nodes) {
      if (node.depends_on) {
        for (const dep of node.depends_on) {
          inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
          const depList = dependents.get(dep);
          if (depList) {
            depList.push(node.id);
          }
        }
      }
    }

    const batches: NodeDefinition[][] = [];
    const processed = new Set<string>();

    while (processed.size < nodes.length) {
      // Find all nodes with in-degree 0 that haven't been processed
      const batch: NodeDefinition[] = [];
      for (const [id, degree] of inDegree.entries()) {
        if (degree === 0 && !processed.has(id)) {
          const node = nodeMap.get(id);
          if (node) {
            batch.push(node);
          }
        }
      }

      if (batch.length === 0) {
        // If no nodes have in-degree 0, we have a cycle
        const remaining = nodes
          .filter((n) => !processed.has(n.id))
          .map((n) => n.id)
          .join(', ');
        throw new Error(
          `Cannot resolve execution order: circular dependency detected among nodes: ${remaining}`
        );
      }

      batches.push(batch);

      // Mark batch as processed and reduce in-degree for dependents
      for (const node of batch) {
        processed.add(node.id);
        const deps = dependents.get(node.id) ?? [];
        for (const depId of deps) {
          inDegree.set(depId, (inDegree.get(depId) ?? 0) - 1);
        }
      }
    }

    return batches;
  }

  private evaluateCondition(
    condition: string,
    completedNodes: Set<string>,
    run: PipelineRun
  ): boolean {
    // Support simple condition formats:
    // "nodeId.success" — check if node completed successfully
    // "nodeId.failed" — check if node failed
    // "nodeId.output.contains('text')" — check output content

    const successMatch = condition.match(/^([\w][\w-]*)\.success$/);
    if (successMatch) {
      const nodeId = successMatch[1];
      return completedNodes.has(nodeId);
    }

    const failedMatch = condition.match(/^([\w][\w-]*)\.failed$/);
    if (failedMatch) {
      const nodeId = failedMatch[1];
      const nodeState = run.nodes.find((n) => n.nodeId === nodeId);
      return nodeState?.status === 'failed';
    }

    const containsMatch = condition.match(
      /^([\w][\w-]*)\.output\.contains\(['"](.+)['"]\)$/
    );
    if (containsMatch) {
      const nodeId = containsMatch[1];
      const searchText = containsMatch[2];
      const nodeState = run.nodes.find((n) => n.nodeId === nodeId);
      return nodeState?.output.includes(searchText) ?? false;
    }

    // Default: treat as truthy if the referenced node completed
    if (completedNodes.has(condition)) {
      return true;
    }

    // Unknown condition format — allow execution
    return true;
  }

  private getFilesForNode(nodeType: NodeType | undefined): string[] {
    if (!nodeType) return [];

    // Only claim files for nodes that can write
    const hasWriteTools = nodeType.tools.some((t) =>
      ['Edit', 'Write', 'write_file'].includes(t)
    );

    if (hasWriteTools) {
      return [`__${nodeType.id}__`];
    }

    return [];
  }

  private dryRun(
    pipeline: PipelineDefinition,
    run: PipelineRun
  ): PipelineRun {
    const executionOrder = this.resolveExecutionOrder(pipeline.nodes);

    let batchIndex = 0;
    for (const batch of executionOrder) {
      for (const node of batch) {
        const nodeType = nodeRegistry.get(node.type);
        const nodeState = run.nodes.find((n) => n.nodeId === node.id);
        if (nodeState) {
          nodeState.status = 'completed';
          nodeState.output = `[DRY RUN] Would execute ${nodeType?.name ?? node.type} (batch ${batchIndex + 1})`;
          nodeState.cost = nodeType?.avgCost ?? 0;
          nodeState.tokens = 0;
          run.totalCost += nodeState.cost;
        }
      }
      batchIndex++;
    }

    run.status = 'completed';
    run.completedAt = new Date().toISOString();

    this.emit('pipeline:complete', run);
    return run;
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private async checkStopSignal(runId: string): Promise<boolean> {
    try {
      const signalPath = join(process.cwd(), '.cortivex', 'signals', `stop-${runId}.json`);
      await readFile(signalPath, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  private async cleanupStopSignal(runId: string): Promise<void> {
    try {
      const signalPath = join(process.cwd(), '.cortivex', 'signals', `stop-${runId}.json`);
      await unlink(signalPath);
    } catch {
      // Signal file doesn't exist, nothing to clean up
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
