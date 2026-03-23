/**
 * cortivex_decompose — Decompose a task description into subtasks with dependencies.
 */
import { generatePipeline } from '@cortivex/core';

export interface DecomposeInput {
  description: string;
  maxDepth?: number;
}

export async function decomposeTool(input: DecomposeInput): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!input.description || input.description.trim() === '') {
    return {
      content: [{
        type: 'text',
        text: 'Error: A task description is required. Describe the task you want to decompose into subtasks.',
      }],
    };
  }

  // Use the pipeline generator to decompose the task into nodes
  const pipeline = generatePipeline('decomposed-task', input.description);

  const sections: string[] = [];

  sections.push([
    `Task Decomposition:`,
    `  Description: ${input.description}`,
    `  Subtasks: ${pipeline.nodes.length}`,
    `  Estimated Cost: ${pipeline.estimated_cost}`,
    `  Estimated Duration: ${pipeline.estimated_duration}`,
  ].join('\n'));

  // Subtask list with dependencies
  const taskLines = pipeline.nodes.map((n, idx) => {
    const deps = n.depends_on && n.depends_on.length > 0
      ? `\n    Depends on: ${n.depends_on.join(', ')}`
      : '\n    Depends on: none (can start immediately)';
    const config = n.config
      ? `\n    Config: ${JSON.stringify(n.config)}`
      : '';
    return [
      `  ${idx + 1}. ${n.id}`,
      `    Type: ${n.type}`,
      deps,
      config,
    ].join('');
  });

  sections.push(`Subtasks:\n${taskLines.join('\n')}`);

  // Execution order
  const phases: string[][] = [];
  const completed = new Set<string>();
  const remaining = [...pipeline.nodes];

  while (remaining.length > 0) {
    const phase = remaining.filter((n) => {
      const deps = n.depends_on ?? [];
      return deps.every((d) => completed.has(d));
    });

    if (phase.length === 0) break; // avoid infinite loop on circular deps

    phases.push(phase.map((n) => n.id));
    for (const n of phase) {
      completed.add(n.id);
      const idx = remaining.indexOf(n);
      if (idx >= 0) remaining.splice(idx, 1);
    }
  }

  const phaseLines = phases.map(
    (p, idx) => `  Phase ${idx + 1}: ${p.join(', ')} (${p.length > 1 ? 'parallel' : 'sequential'})`,
  );
  sections.push(`Execution Order:\n${phaseLines.join('\n')}`);

  return {
    content: [{ type: 'text', text: sections.join('\n\n') }],
  };
}
