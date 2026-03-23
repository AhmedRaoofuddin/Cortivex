import { EventEmitter } from 'eventemitter3';
import type { PipelineDefinition, PipelineRun, NodeRunState, ExecuteOptions, NodeDefinition } from '../types.js';
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
export declare class PipelineExecutor extends EventEmitter<ExecutorEvents> {
    private readonly runner;
    private readonly mesh;
    private readonly recorder;
    constructor(baseDir?: string);
    execute(pipeline: PipelineDefinition, options?: ExecuteOptions): Promise<PipelineRun>;
    private executeNode;
    /**
     * Resolves execution order from the DAG using topological sort.
     * Returns batches of nodes that can be executed in parallel.
     */
    resolveExecutionOrder(nodes: NodeDefinition[]): NodeDefinition[][];
    private evaluateCondition;
    private getFilesForNode;
    private dryRun;
    private chunkArray;
    private checkStopSignal;
    private cleanupStopSignal;
    private delay;
}
//# sourceMappingURL=executor.d.ts.map