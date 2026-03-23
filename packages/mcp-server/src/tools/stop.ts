/**
 * cortivex_stop — Stop a running pipeline by run ID.
 */
import { PipelineExecutor } from '@cortivex/core';
import { getRunById } from './run.js';

export interface StopInput {
  runId: string;
}

export async function stopTool(input: StopInput): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!input.runId || input.runId.trim() === '') {
    return {
      content: [{
        type: 'text',
        text: 'Error: runId is required. Use cortivex_status to see active runs.',
      }],
    };
  }

  const run = getRunById(input.runId);
  if (!run) {
    return {
      content: [{
        type: 'text',
        text: `No pipeline run found with ID "${input.runId}". Use cortivex_status to see active runs.`,
      }],
    };
  }

  if (run.status !== 'running') {
    return {
      content: [{
        type: 'text',
        text: `Pipeline run "${input.runId}" is not currently running (status: ${run.status}). Only running pipelines can be stopped.`,
      }],
    };
  }

  const executor = new PipelineExecutor();
  await executor.stop(input.runId);

  return {
    content: [{
      type: 'text',
      text: [
        `Pipeline run stopped successfully.`,
        ``,
        `Run ID: ${input.runId}`,
        `Pipeline: ${run.pipeline}`,
        `Status: cancelled`,
        `Nodes completed before stop: ${run.nodes.filter((n) => n.status === 'completed').length}/${run.nodes.length}`,
      ].join('\n'),
    }],
  };
}
