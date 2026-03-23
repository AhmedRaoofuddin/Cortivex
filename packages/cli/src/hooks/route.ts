/**
 * Route Hook — UserPromptSubmit
 *
 * Inspects the user's prompt to detect pipeline-related intent.
 * If the prompt matches known pipeline keywords, outputs a suggestion
 * to route the task to the appropriate Cortivex pipeline.
 *
 * Claude Code passes the hook context as JSON on stdin.
 * Expected input shape:
 *   { event: "UserPromptSubmit", data: { prompt: string } }
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface HookInput {
  event: string;
  data: {
    prompt: string;
    [key: string]: unknown;
  };
}

interface RouteResult {
  continue: boolean;
  suppress?: boolean;
  message?: string;
}

const PIPELINE_INTENT_MAP: Record<string, string[]> = {
  'pr-review': ['review', 'pr', 'pull request', 'code review'],
  'security-audit': ['security', 'scan', 'vulnerability', 'audit', 'cve'],
  'test-suite': ['test', 'coverage', 'unit test', 'e2e'],
  'quick-fix': ['fix', 'lint', 'format'],
  'refactor': ['refactor', 'restructure', 'architecture'],
  'docs-generator': ['document', 'docs', 'api spec'],
  'ts-migration': ['typescript', 'migrate', 'ts'],
  'ci-setup': ['deploy', 'ci', 'cd', 'github actions'],
};

function detectIntent(prompt: string): { pipeline: string; confidence: number } | null {
  const lower = prompt.toLowerCase();

  let bestMatch: { pipeline: string; confidence: number } | null = null;

  for (const [pipeline, keywords] of Object.entries(PIPELINE_INTENT_MAP)) {
    let matchCount = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        matchCount++;
      }
    }
    if (matchCount > 0) {
      const confidence = matchCount / keywords.length;
      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = { pipeline, confidence };
      }
    }
  }

  return bestMatch;
}

async function main(): Promise<void> {
  let rawInput = '';

  // Read JSON from stdin
  try {
    rawInput = readFileSync(0, 'utf-8');
  } catch {
    // stdin may be empty or closed
    process.exit(0);
  }

  if (!rawInput.trim()) {
    const result: RouteResult = { continue: true };
    process.stdout.write(JSON.stringify(result));
    return;
  }

  let input: HookInput;
  try {
    input = JSON.parse(rawInput) as HookInput;
  } catch {
    const result: RouteResult = { continue: true };
    process.stdout.write(JSON.stringify(result));
    return;
  }

  const prompt = input.data?.prompt ?? '';
  if (!prompt) {
    const result: RouteResult = { continue: true };
    process.stdout.write(JSON.stringify(result));
    return;
  }

  // Check if the prompt contains the word "pipeline" explicitly
  const explicitPipeline = prompt.toLowerCase().includes('pipeline');

  const match = detectIntent(prompt);

  if (match && (match.confidence >= 0.5 || explicitPipeline)) {
    // Check if the pipeline exists as a saved pipeline
    let pipelineExists = false;
    try {
      const cortivexDir = join(process.cwd(), '.cortivex', 'pipelines');
      readFileSync(join(cortivexDir, `${match.pipeline}.yaml`), 'utf-8');
      pipelineExists = true;
    } catch {
      // Pipeline file not found — still suggest it as a template
    }

    const result: RouteResult = {
      continue: true,
      message: `Detected pipeline intent: "${match.pipeline}" (confidence: ${(match.confidence * 100).toFixed(0)}%). ${
        pipelineExists
          ? `Run with: cortivex run ${match.pipeline}`
          : `Available as built-in template: cortivex run ${match.pipeline}`
      }`,
    };
    process.stdout.write(JSON.stringify(result));
  } else {
    const result: RouteResult = { continue: true };
    process.stdout.write(JSON.stringify(result));
  }
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ continue: true }));
});
