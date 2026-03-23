/**
 * cortivex_knowledge — Query the shared CRDT knowledge graph.
 */
import { MeshManager } from '@cortivex/core';

export interface KnowledgeInput {
  query?: string;
  nodeType?: string;
  limit?: number;
}

export async function knowledgeTool(input: KnowledgeInput): Promise<{ content: Array<{ type: string; text: string }> }> {
  const mesh = new MeshManager();
  const knowledge = await mesh.queryKnowledge({
    query: input.query,
    nodeType: input.nodeType,
    limit: input.limit ?? 50,
  });

  const sections: string[] = [];

  // Summary
  sections.push([
    `Knowledge Graph${input.query ? ` (query: "${input.query}")` : ''}:`,
    `  Total Entries: ${knowledge.totalEntries}`,
    `  Node Types: ${knowledge.nodeTypes.join(', ') || 'none'}`,
    `  Last Updated: ${knowledge.lastUpdated}`,
  ].join('\n'));

  // Entries
  if (knowledge.entries.length > 0) {
    const entryLines = knowledge.entries.map((e: Record<string, unknown>) => {
      const meta = e.source ? ` (source: ${e.source})` : '';
      return [
        `  - [${e.type}] ${e.summary}`,
        `    ID: ${e.id}`,
        `    Confidence: ${((e.confidence as number) * 100).toFixed(0)}%${meta}`,
        `    Created: ${e.createdAt}`,
      ].join('\n');
    });
    sections.push(`Entries (${knowledge.entries.length}):\n${entryLines.join('\n')}`);
  } else {
    sections.push(
      'Entries: none\n' +
      '  No knowledge entries found. Run pipelines with KnowledgeCurator nodes to populate the knowledge graph.',
    );
  }

  // Edges
  if (knowledge.edges && knowledge.edges.length > 0) {
    const edgeLines = knowledge.edges
      .slice(0, 20)
      .map((e: Record<string, unknown>) => `  ${e.from} --[${e.relation}]--> ${e.to}`);
    const moreStr = knowledge.edges.length > 20 ? `\n  ... and ${knowledge.edges.length - 20} more` : '';
    sections.push(`Relationships (${knowledge.edges.length}):\n${edgeLines.join('\n')}${moreStr}`);
  }

  return {
    content: [{ type: 'text', text: sections.join('\n\n') }],
  };
}
