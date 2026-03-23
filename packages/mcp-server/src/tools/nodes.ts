/**
 * cortivex_nodes — List available agent node types with their configurations.
 */
import { nodeRegistry } from '@cortivex/core';

export interface NodesInput {
  category?: string;
}

export async function nodesTool(input: NodesInput): Promise<{ content: Array<{ type: string; text: string }> }> {
  const allNodes = nodeRegistry.getAll();
  const categories = new Set(allNodes.map((n) => n.category));

  // Filter by category if provided
  const filtered = input.category
    ? allNodes.filter((n) => n.category === input.category)
    : allNodes;

  if (filtered.length === 0) {
    if (input.category) {
      return {
        content: [{
          type: 'text',
          text: `No node types found in category "${input.category}". Available categories: ${[...categories].join(', ')}`,
        }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: 'No node types registered.',
      }],
    };
  }

  const sections: string[] = [];

  sections.push([
    `Available Node Types${input.category ? ` (category: ${input.category})` : ''}:`,
    `  Total: ${filtered.length}`,
    `  Categories: ${[...categories].join(', ')}`,
  ].join('\n'));

  // Group by category
  const grouped = new Map<string, typeof filtered>();
  for (const node of filtered) {
    const cat = node.category;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(node);
  }

  for (const [cat, nodes] of grouped) {
    const nodeLines = nodes.map((n) => [
      `  - ${n.name} (${n.id})`,
      `    ${n.description}`,
      `    Model: ${n.defaultModel} | Avg Cost: $${n.avgCost.toFixed(2)} | Avg Duration: ${n.avgDuration}s`,
      `    Success Rate: ${(n.successRate * 100).toFixed(0)}%`,
      `    Tools: ${n.tools.length > 0 ? n.tools.join(', ') : 'none'}`,
    ].join('\n'));

    sections.push(`${cat.charAt(0).toUpperCase() + cat.slice(1)} (${nodes.length}):\n${nodeLines.join('\n')}`);
  }

  return {
    content: [{ type: 'text', text: sections.join('\n\n') }],
  };
}
