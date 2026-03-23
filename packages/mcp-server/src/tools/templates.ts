/**
 * cortivex_templates — List available pipeline templates with details.
 */
import { PipelineLoader } from '@cortivex/core';

export interface TemplatesInput {
  tag?: string;
}

export async function templatesTool(input: TemplatesInput): Promise<{ content: Array<{ type: string; text: string }> }> {
  const loader = new PipelineLoader();
  const all = await loader.listPipelines();
  const templates = all.filter((p) => p.source === 'built-in');

  // Filter by tag if provided
  const filtered = input.tag
    ? templates.filter((t) => t.tags.includes(input.tag!))
    : templates;

  if (filtered.length === 0) {
    if (input.tag) {
      const allTags = new Set(templates.flatMap((t) => t.tags));
      return {
        content: [{
          type: 'text',
          text: `No templates found with tag "${input.tag}". Available tags: ${[...allTags].join(', ')}`,
        }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: 'No pipeline templates available.',
      }],
    };
  }

  const sections: string[] = [];

  sections.push([
    `Pipeline Templates${input.tag ? ` (tag: ${input.tag})` : ''}:`,
    `  Total: ${filtered.length}`,
  ].join('\n'));

  const templateLines = filtered.map((t) => [
    `  - ${t.name}`,
    `    ${t.description}`,
    `    Nodes: ${t.nodeCount} | Tags: ${t.tags.join(', ')}`,
  ].join('\n'));

  sections.push(templateLines.join('\n'));

  sections.push('Use cortivex_run with any template name to execute it.');

  return {
    content: [{ type: 'text', text: sections.join('\n\n') }],
  };
}
