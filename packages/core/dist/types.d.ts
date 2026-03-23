export interface PipelineDefinition {
    name: string;
    version: string;
    description: string;
    tags: string[];
    estimated_cost: string;
    estimated_duration: string;
    nodes: NodeDefinition[];
}
export interface NodeDefinition {
    id: string;
    type: string;
    depends_on?: string[];
    condition?: string;
    config?: Record<string, unknown>;
}
export interface NodeType {
    id: string;
    name: string;
    description: string;
    category: NodeCategory;
    icon: string;
    color: string;
    defaultModel: string;
    systemPrompt: string;
    tools: string[];
    avgCost: number;
    avgDuration: number;
    successRate: number;
}
export type NodeCategory = 'quality' | 'security' | 'testing' | 'devops' | 'docs' | 'refactoring' | 'analysis' | 'orchestration';
export type PipelineStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export interface PipelineRun {
    id: string;
    pipeline: string;
    status: PipelineStatus;
    startedAt: string;
    completedAt?: string;
    nodes: NodeRunState[];
    totalCost: number;
    totalTokens: number;
    filesModified: string[];
}
export interface NodeRunState {
    nodeId: string;
    status: NodeStatus;
    startedAt?: string;
    completedAt?: string;
    progress: number;
    cost: number;
    tokens: number;
    output: string;
    error?: string;
    filesModified: string[];
}
export interface ExecuteOptions {
    dryRun?: boolean;
    failureStrategy?: 'stop' | 'continue' | 'retry';
    maxRetries?: number;
    parallelism?: number;
    verbose?: boolean;
    targetDir?: string;
    model?: string;
    timeout?: number;
}
export interface MeshClaim {
    agentId: string;
    nodeId: string;
    pipelineRunId: string;
    files: string[];
    status: 'active' | 'completed' | 'failed';
    claimedAt: string;
    lastUpdate: string;
}
export interface MeshConflict {
    file: string;
    claimedBy: string;
    requestedBy: string;
    timestamp: string;
}
export interface MeshState {
    claims: MeshClaim[];
    conflicts: MeshConflict[];
    lastCleanup: string;
}
export interface ExecutionRecord {
    id: string;
    pipeline: string;
    timestamp: string;
    success: boolean;
    totalCost: number;
    totalDuration: number;
    nodeResults: NodeResult[];
    repoContext: RepoContext;
}
export interface NodeResult {
    nodeId: string;
    nodeType: string;
    success: boolean;
    cost: number;
    duration: number;
    model: string;
    error?: string;
}
export interface RepoContext {
    languages: string[];
    framework?: string;
    hasTests: boolean;
    fileCount: number;
    hasAuth: boolean;
}
export interface Insight {
    id: string;
    pattern: string;
    description: string;
    confidence: number;
    basedOnRuns: number;
    action: InsightAction;
    details: Record<string, unknown>;
    discoveredAt: string;
}
export type InsightAction = 'reorder' | 'substitute_model' | 'skip_node' | 'add_node' | 'adjust_config' | 'adjust_timeout';
export interface PipelineEvent {
    type: PipelineEventType;
    timestamp: string;
    data: Record<string, unknown>;
}
export type PipelineEventType = 'node:start' | 'node:progress' | 'node:complete' | 'node:failed' | 'pipeline:start' | 'pipeline:complete' | 'pipeline:failed' | 'mesh:claim' | 'mesh:conflict' | 'mesh:release';
export interface StreamMessage {
    type: 'assistant' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_start' | 'message_delta' | 'message_stop' | 'result';
    subtype?: string;
    content_block?: {
        type: string;
        text?: string;
    };
    delta?: {
        type: string;
        text?: string;
    };
    result?: {
        cost_usd?: number;
        input_tokens?: number;
        output_tokens?: number;
        duration_ms?: number;
    };
}
export interface PipelineTemplate {
    id: string;
    name: string;
    description: string;
    tags: string[];
    pipeline: PipelineDefinition;
}
export interface AggregateStats {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    successRate: number;
    averageCost: number;
    totalCost: number;
    averageDuration: number;
    mostUsedPipeline: string;
    mostExpensiveNode: string;
    leastReliableNode: string;
}
//# sourceMappingURL=types.d.ts.map