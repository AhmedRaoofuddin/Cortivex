import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  PipelineRun,
  ExecutionRecord,
  RepoContext,
  AggregateStats,
} from '../types.js';

const CORTIVEX_DIR = '.cortivex';
const HISTORY_DIR = 'history';

export class HistoryRecorder {
  private readonly historyDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.historyDir = join(baseDir, CORTIVEX_DIR, HISTORY_DIR);
  }

  /**
   * Record a pipeline run to the history directory.
   */
  async record(run: PipelineRun): Promise<ExecutionRecord> {
    await this.ensureDir();

    const record: ExecutionRecord = {
      id: run.id,
      pipeline: run.pipeline,
      timestamp: run.startedAt,
      success: run.status === 'completed',
      totalCost: run.totalCost,
      totalDuration: this.calculateDuration(run.startedAt, run.completedAt),
      nodeResults: run.nodes.map((n) => ({
        nodeId: n.nodeId,
        nodeType: n.nodeId,
        success: n.status === 'completed',
        cost: n.cost,
        duration: this.calculateDuration(n.startedAt, n.completedAt),
        model: 'claude-sonnet-4-20250514',
        error: n.error,
      })),
      repoContext: await this.detectRepoContext(),
    };

    const filename = `${this.sanitizeTimestamp(run.startedAt)}-${run.id.slice(0, 8)}.json`;
    const filePath = join(this.historyDir, filename);

    await writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8');

    return record;
  }

  /**
   * Get all execution history, optionally filtered by pipeline name.
   */
  async getHistory(pipeline?: string): Promise<ExecutionRecord[]> {
    await this.ensureDir();

    const records: ExecutionRecord[] = [];

    try {
      const files = await readdir(this.historyDir);
      const jsonFiles = files
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse();

      for (const file of jsonFiles) {
        try {
          const content = await readFile(
            join(this.historyDir, file),
            'utf-8'
          );
          const record = JSON.parse(content) as ExecutionRecord;

          if (!pipeline || record.pipeline === pipeline) {
            records.push(record);
          }
        } catch {
          // Skip corrupt files
        }
      }
    } catch {
      // History directory doesn't exist yet
    }

    return records;
  }

  /**
   * Get aggregate statistics across all executions.
   */
  async getStats(): Promise<AggregateStats> {
    const records = await this.getHistory();

    if (records.length === 0) {
      return {
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        successRate: 0,
        averageCost: 0,
        totalCost: 0,
        averageDuration: 0,
        mostUsedPipeline: 'none',
        mostExpensiveNode: 'none',
        leastReliableNode: 'none',
      };
    }

    const successfulRuns = records.filter((r) => r.success).length;
    const totalCost = records.reduce((sum, r) => sum + r.totalCost, 0);
    const totalDuration = records.reduce((sum, r) => sum + r.totalDuration, 0);

    // Most used pipeline
    const pipelineCounts = new Map<string, number>();
    for (const record of records) {
      pipelineCounts.set(
        record.pipeline,
        (pipelineCounts.get(record.pipeline) ?? 0) + 1
      );
    }
    const mostUsedPipeline =
      [...pipelineCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      'none';

    // Most expensive node type
    const nodeCosts = new Map<string, number[]>();
    const nodeSuccesses = new Map<
      string,
      { success: number; total: number }
    >();

    for (const record of records) {
      for (const node of record.nodeResults) {
        const costs = nodeCosts.get(node.nodeType) ?? [];
        costs.push(node.cost);
        nodeCosts.set(node.nodeType, costs);

        const stats = nodeSuccesses.get(node.nodeType) ?? {
          success: 0,
          total: 0,
        };
        stats.total++;
        if (node.success) stats.success++;
        nodeSuccesses.set(node.nodeType, stats);
      }
    }

    let mostExpensiveNode = 'none';
    let maxAvgCost = 0;
    for (const [nodeType, costs] of nodeCosts.entries()) {
      const avg = costs.reduce((sum, c) => sum + c, 0) / costs.length;
      if (avg > maxAvgCost) {
        maxAvgCost = avg;
        mostExpensiveNode = nodeType;
      }
    }

    let leastReliableNode = 'none';
    let lowestSuccessRate = 1;
    for (const [nodeType, stats] of nodeSuccesses.entries()) {
      if (stats.total >= 2) {
        const rate = stats.success / stats.total;
        if (rate < lowestSuccessRate) {
          lowestSuccessRate = rate;
          leastReliableNode = nodeType;
        }
      }
    }

    return {
      totalRuns: records.length,
      successfulRuns,
      failedRuns: records.length - successfulRuns,
      successRate: successfulRuns / records.length,
      averageCost: totalCost / records.length,
      totalCost,
      averageDuration: totalDuration / records.length,
      mostUsedPipeline,
      mostExpensiveNode,
      leastReliableNode,
    };
  }

  /**
   * Delete all history older than the specified number of days.
   */
  async prune(olderThanDays: number): Promise<number> {
    await this.ensureDir();
    let pruned = 0;
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    try {
      const files = await readdir(this.historyDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const content = await readFile(
            join(this.historyDir, file),
            'utf-8'
          );
          const record = JSON.parse(content) as ExecutionRecord;
          const recordTime = new Date(record.timestamp).getTime();

          if (recordTime < cutoff) {
            await unlink(join(this.historyDir, file));
            pruned++;
          }
        } catch {
          // Skip corrupt files
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return pruned;
  }

  /**
   * Get all execution runs (alias for getHistory).
   */
  async getRuns(): Promise<ExecutionRecord[]> {
    return this.getHistory();
  }

  /**
   * Get a single execution record by its run ID.
   */
  async getRunById(runId: string): Promise<ExecutionRecord | null> {
    const records = await this.getHistory();
    return records.find((record) => record.id === runId) ?? null;
  }

  private calculateDuration(
    startedAt?: string,
    completedAt?: string
  ): number {
    if (!startedAt || !completedAt) return 0;
    return (
      (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000
    );
  }

  private sanitizeTimestamp(iso: string): string {
    return iso.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  }

  private async detectRepoContext(): Promise<RepoContext> {
    const context: RepoContext = {
      languages: [],
      hasTests: false,
      fileCount: 0,
      hasAuth: false,
    };

    try {
      try {
        const pkgContent = await readFile(
          join(process.cwd(), 'package.json'),
          'utf-8'
        );
        const pkg = JSON.parse(pkgContent) as Record<string, unknown>;

        if (!context.languages.includes('javascript')) {
          context.languages.push('javascript');
        }

        const deps: Record<string, string> = {
          ...((pkg['dependencies'] as Record<string, string>) ?? {}),
          ...((pkg['devDependencies'] as Record<string, string>) ?? {}),
        };

        if (deps['next']) context.framework = 'Next.js';
        else if (deps['react']) context.framework = 'React';
        else if (deps['vue']) context.framework = 'Vue';
        else if (deps['@angular/core']) context.framework = 'Angular';
        else if (deps['express']) context.framework = 'Express';
        else if (deps['fastify']) context.framework = 'Fastify';
        else if (deps['hono']) context.framework = 'Hono';

        if (deps['typescript']) {
          if (!context.languages.includes('typescript')) {
            context.languages.push('typescript');
          }
        }

        if (
          deps['jest'] ||
          deps['vitest'] ||
          deps['mocha'] ||
          deps['@playwright/test']
        ) {
          context.hasTests = true;
        }

        if (
          deps['passport'] ||
          deps['next-auth'] ||
          deps['@auth/core'] ||
          deps['jsonwebtoken'] ||
          deps['bcrypt']
        ) {
          context.hasAuth = true;
        }
      } catch {
        // No package.json
      }

      try {
        await readFile(join(process.cwd(), 'pyproject.toml'), 'utf-8');
        if (!context.languages.includes('python')) {
          context.languages.push('python');
        }
      } catch {
        // No pyproject.toml
      }

      try {
        await readFile(join(process.cwd(), 'requirements.txt'), 'utf-8');
        if (!context.languages.includes('python')) {
          context.languages.push('python');
        }
      } catch {
        // No requirements.txt
      }

      try {
        await readFile(join(process.cwd(), 'Cargo.toml'), 'utf-8');
        if (!context.languages.includes('rust')) {
          context.languages.push('rust');
        }
      } catch {
        // No Cargo.toml
      }

      try {
        await readFile(join(process.cwd(), 'go.mod'), 'utf-8');
        if (!context.languages.includes('go')) {
          context.languages.push('go');
        }
      } catch {
        // No go.mod
      }
    } catch {
      // Ignore all detection errors
    }

    if (context.languages.length === 0) {
      context.languages.push('unknown');
    }

    return context;
  }

  private async ensureDir(): Promise<void> {
    try {
      await mkdir(this.historyDir, { recursive: true });
    } catch {
      // Already exists
    }
  }
}
