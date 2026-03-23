/**
 * cortivex_tasks — List active tasks across all running pipelines.
 */
import { getActiveRuns } from './run.js';

export interface TasksInput {
  status?: string;
}

export async function tasksTool(input: TasksInput): Promise<{ content: Array<{ type: string; text: string }> }> {
  const activeRuns = getActiveRuns();

  if (activeRuns.length === 0) {
    return {
      content: [{
        type: 'text',
        text: 'No active tasks. No pipelines are currently running.',
      }],
    };
  }

  const sections: string[] = [];

  // Collect all tasks across runs
  const allTasks: Array<{
    runId: string;
    pipeline: string;
    nodeId: string;
    status: string;
    progress: number;
    cost: number;
    error?: string;
  }> = [];

  for (const run of activeRuns) {
    for (const node of run.nodes) {
      allTasks.push({
        runId: run.id,
        pipeline: run.pipeline,
        nodeId: node.nodeId,
        status: node.status,
        progress: node.progress,
        cost: node.cost,
        error: node.error,
      });
    }
  }

  // Filter by status if provided
  const filtered = input.status
    ? allTasks.filter((t) => t.status === input.status)
    : allTasks;

  if (filtered.length === 0) {
    return {
      content: [{
        type: 'text',
        text: input.status
          ? `No tasks with status "${input.status}". Active statuses: ${[...new Set(allTasks.map((t) => t.status))].join(', ')}`
          : 'No tasks found across active pipelines.',
      }],
    };
  }

  // Summary counts
  const statusCounts = new Map<string, number>();
  for (const t of allTasks) {
    statusCounts.set(t.status, (statusCounts.get(t.status) ?? 0) + 1);
  }

  const countStr = [...statusCounts.entries()]
    .map(([s, c]) => `${s}: ${c}`)
    .join(', ');

  sections.push([
    `Active Tasks (${filtered.length}${input.status ? ` filtered by "${input.status}"` : ''}):`,
    `  Across ${activeRuns.length} running pipeline(s)`,
    `  Status breakdown: ${countStr}`,
  ].join('\n'));

  // Task details
  const taskLines = filtered.map((t) => {
    const icon = t.status === 'completed' ? '[OK]'
      : t.status === 'failed' ? '[FAIL]'
      : t.status === 'running' ? '[RUNNING]'
      : t.status === 'skipped' ? '[SKIP]'
      : '[PENDING]';
    const progress = t.status === 'running' ? ` ${t.progress}%` : '';
    const costStr = t.cost > 0 ? ` | Cost: $${t.cost.toFixed(4)}` : '';
    const errStr = t.error ? `\n    Error: ${t.error}` : '';
    return `  ${icon} ${t.nodeId}${progress}${costStr}\n    Pipeline: ${t.pipeline} (Run: ${t.runId})${errStr}`;
  });

  sections.push(taskLines.join('\n'));

  return {
    content: [{ type: 'text', text: sections.join('\n\n') }],
  };
}
