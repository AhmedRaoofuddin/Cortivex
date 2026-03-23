/**
 * cortivex_scale — Adjust the agent pool size for pipeline execution.
 */
import { PipelineExecutor } from '@cortivex/core';

export interface ScaleInput {
  poolSize: number;
  nodeType?: string;
}

export async function scaleTool(input: ScaleInput): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (input.poolSize === undefined || input.poolSize === null) {
    return {
      content: [{
        type: 'text',
        text: 'Error: poolSize is required. Specify the desired number of concurrent agents.',
      }],
    };
  }

  if (typeof input.poolSize !== 'number' || input.poolSize < 1) {
    return {
      content: [{
        type: 'text',
        text: 'Error: poolSize must be a positive integer (minimum 1).',
      }],
    };
  }

  if (input.poolSize > 20) {
    return {
      content: [{
        type: 'text',
        text: 'Error: poolSize cannot exceed 20. Higher values risk excessive API costs and rate limits.',
      }],
    };
  }

  const executor = new PipelineExecutor();
  const previous = await executor.getPoolSize(input.nodeType);
  await executor.setPoolSize(input.poolSize, input.nodeType);

  const scope = input.nodeType ? ` for node type "${input.nodeType}"` : ' (global)';

  return {
    content: [{
      type: 'text',
      text: [
        `Agent pool size updated${scope}:`,
        `  Previous: ${previous}`,
        `  New: ${input.poolSize}`,
        ``,
        `This affects the maximum number of concurrent agents${input.nodeType ? ` of type "${input.nodeType}"` : ''} during pipeline execution.`,
      ].join('\n'),
    }],
  };
}
