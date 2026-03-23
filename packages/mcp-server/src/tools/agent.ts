/**
 * cortivex_agent — Get information about a specific agent in a running pipeline.
 */
import { getActiveRuns, getRunById } from './run.js';

export interface AgentInput {
  agentId: string;
  runId?: string;
}

export async function agentTool(input: AgentInput): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!input.agentId || input.agentId.trim() === '') {
    return {
      content: [{
        type: 'text',
        text: 'Error: agentId is required. Provide the node ID of the agent to inspect.',
      }],
    };
  }

  // If a runId is given, search only in that run
  if (input.runId) {
    const run = getRunById(input.runId);
    if (!run) {
      return {
        content: [{
          type: 'text',
          text: `No pipeline run found with ID "${input.runId}". Use cortivex_status to see active runs.`,
        }],
      };
    }

    const node = run.nodes.find((n) => n.nodeId === input.agentId);
    if (!node) {
      return {
        content: [{
          type: 'text',
          text: `No agent "${input.agentId}" found in run "${input.runId}". Available agents: ${run.nodes.map((n) => n.nodeId).join(', ')}`,
        }],
      };
    }

    return {
      content: [{ type: 'text', text: formatAgent(node, run.id, run.pipeline) }],
    };
  }

  // Search across all active runs
  const activeRuns = getActiveRuns();
  const matches: Array<{ node: typeof activeRuns[0]['nodes'][0]; runId: string; pipeline: string }> = [];

  for (const run of activeRuns) {
    const node = run.nodes.find((n) => n.nodeId === input.agentId);
    if (node) {
      matches.push({ node, runId: run.id, pipeline: run.pipeline });
    }
  }

  if (matches.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `No agent "${input.agentId}" found in any active pipeline run. Use cortivex_status to see active runs and their agents.`,
      }],
    };
  }

  if (matches.length === 1) {
    const m = matches[0];
    return {
      content: [{ type: 'text', text: formatAgent(m.node, m.runId, m.pipeline) }],
    };
  }

  // Multiple matches across runs
  const lines = matches.map((m) => formatAgent(m.node, m.runId, m.pipeline));
  return {
    content: [{
      type: 'text',
      text: `Agent "${input.agentId}" found in ${matches.length} runs:\n\n${lines.join('\n\n---\n\n')}`,
    }],
  };
}

function formatAgent(
  node: { nodeId: string; status: string; startedAt?: string; completedAt?: string; progress: number; cost: number; tokens: number; output: string; error?: string; filesModified: string[] },
  runId: string,
  pipeline: string,
): string {
  const duration = node.startedAt
    ? node.completedAt
      ? `${((Date.parse(node.completedAt) - Date.parse(node.startedAt)) / 1000).toFixed(1)}s`
      : `${((Date.now() - Date.parse(node.startedAt)) / 1000).toFixed(1)}s (in progress)`
    : 'not started';

  const filesStr = node.filesModified.length > 0
    ? node.filesModified.length > 5
      ? `${node.filesModified.slice(0, 5).join(', ')} (+${node.filesModified.length - 5} more)`
      : node.filesModified.join(', ')
    : 'none';

  const outputPreview = node.output
    ? node.output.length > 500
      ? `${node.output.slice(0, 500)}... (truncated, ${node.output.length} chars total)`
      : node.output
    : 'no output';

  const lines = [
    `Agent: ${node.nodeId}`,
    `Run: ${runId}`,
    `Pipeline: ${pipeline}`,
    `Status: ${node.status}`,
    `Progress: ${node.progress}%`,
    `Duration: ${duration}`,
    `Cost: $${node.cost.toFixed(4)}`,
    `Tokens: ${node.tokens}`,
    `Files Modified: ${filesStr}`,
  ];

  if (node.error) {
    lines.push(`Error: ${node.error}`);
  }

  lines.push(``, `Output:`, outputPreview);

  return lines.join('\n');
}
