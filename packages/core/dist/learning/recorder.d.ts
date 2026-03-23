import type { PipelineRun, ExecutionRecord, AggregateStats } from '../types.js';
export declare class HistoryRecorder {
    private readonly historyDir;
    constructor(baseDir?: string);
    /**
     * Record a pipeline run to the history directory.
     */
    record(run: PipelineRun): Promise<ExecutionRecord>;
    /**
     * Get all execution history, optionally filtered by pipeline name.
     */
    getHistory(pipeline?: string): Promise<ExecutionRecord[]>;
    /**
     * Get aggregate statistics across all executions.
     */
    getStats(): Promise<AggregateStats>;
    /**
     * Delete all history older than the specified number of days.
     */
    prune(olderThanDays: number): Promise<number>;
    /**
     * Get all execution runs (alias for getHistory).
     */
    getRuns(): Promise<ExecutionRecord[]>;
    /**
     * Get a single execution record by its run ID.
     */
    getRunById(runId: string): Promise<ExecutionRecord | null>;
    private calculateDuration;
    private sanitizeTimestamp;
    private detectRepoContext;
    private ensureDir;
}
//# sourceMappingURL=recorder.d.ts.map