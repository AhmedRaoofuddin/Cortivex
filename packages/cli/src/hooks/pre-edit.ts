/**
 * Pre-Edit Hook — PreToolUse (Edit|Write)
 *
 * Checks mesh ownership before a file edit is performed.
 * If another agent has an active claim on the file, the hook
 * blocks the edit to prevent conflicts between concurrent agents.
 *
 * Claude Code passes the hook context as JSON on stdin.
 * Expected input shape:
 *   { event: "PreToolUse", tool: string, data: { file_path?: string, ... } }
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface HookInput {
  event: string;
  tool: string;
  session_id?: string;
  data: {
    file_path?: string;
    [key: string]: unknown;
  };
}

interface MeshClaim {
  agentId: string;
  nodeId: string;
  pipelineRunId: string;
  files: string[];
  status: string;
  claimedAt: string;
  lastUpdate: string;
}

interface MeshState {
  claims: MeshClaim[];
}

interface PreEditResult {
  continue: boolean;
  reason?: string;
}

function loadMeshState(cwd: string): MeshState | null {
  const meshPath = join(cwd, '.cortivex', 'mesh', 'state.json');
  if (!existsSync(meshPath)) {
    return null;
  }
  try {
    const raw = readFileSync(meshPath, 'utf-8');
    return JSON.parse(raw) as MeshState;
  } catch {
    return null;
  }
}

function checkFileClaim(
  meshState: MeshState,
  filePath: string,
  currentSessionId: string | undefined,
): MeshClaim | null {
  const normalizedPath = resolve(filePath);

  for (const claim of meshState.claims) {
    if (claim.status !== 'active') continue;

    // Skip claims from the current session
    if (currentSessionId && claim.agentId === currentSessionId) continue;

    for (const claimedFile of claim.files) {
      if (resolve(claimedFile) === normalizedPath) {
        return claim;
      }
    }
  }

  return null;
}

async function main(): Promise<void> {
  let rawInput = '';

  try {
    rawInput = readFileSync(0, 'utf-8');
  } catch {
    process.exit(0);
  }

  if (!rawInput.trim()) {
    const result: PreEditResult = { continue: true };
    process.stdout.write(JSON.stringify(result));
    return;
  }

  let input: HookInput;
  try {
    input = JSON.parse(rawInput) as HookInput;
  } catch {
    const result: PreEditResult = { continue: true };
    process.stdout.write(JSON.stringify(result));
    return;
  }

  const filePath = input.data?.file_path;
  if (!filePath) {
    // No file path in the tool call — allow it
    const result: PreEditResult = { continue: true };
    process.stdout.write(JSON.stringify(result));
    return;
  }

  const cwd = process.cwd();
  const meshState = loadMeshState(cwd);

  if (!meshState) {
    // No mesh state file — no claims to check
    const result: PreEditResult = { continue: true };
    process.stdout.write(JSON.stringify(result));
    return;
  }

  const conflictingClaim = checkFileClaim(meshState, filePath, input.session_id);

  if (conflictingClaim) {
    const result: PreEditResult = {
      continue: false,
      reason: `File "${filePath}" is currently claimed by agent "${conflictingClaim.agentId}" (node: ${conflictingClaim.nodeId}, run: ${conflictingClaim.pipelineRunId}). Wait for the claim to be released or use "cortivex mesh --cleanup" to clear stale claims.`,
    };
    process.stdout.write(JSON.stringify(result));
  } else {
    const result: PreEditResult = { continue: true };
    process.stdout.write(JSON.stringify(result));
  }
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ continue: true }));
});
