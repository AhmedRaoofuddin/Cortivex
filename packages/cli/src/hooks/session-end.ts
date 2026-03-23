/**
 * Session End Hook — Stop
 *
 * Cleans up mesh claims held by the current session when it ends.
 * Releases any active file ownership claims so other agents are
 * no longer blocked, and records session metrics.
 *
 * Claude Code passes the hook context as JSON on stdin.
 * Expected input shape:
 *   { event: "Stop", data: { session_id?: string } }
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface HookInput {
  event: string;
  data: {
    session_id?: string;
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

interface SessionRecord {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  cwd: string;
  configLoaded: boolean;
}

interface SessionEndResult {
  continue: boolean;
}

function releaseClaims(cwd: string, sessionId: string): number {
  const meshStatePath = join(cwd, '.cortivex', 'mesh', 'state.json');
  if (!existsSync(meshStatePath)) {
    return 0;
  }

  let meshState: MeshState;
  try {
    const raw = readFileSync(meshStatePath, 'utf-8');
    meshState = JSON.parse(raw) as MeshState;
  } catch {
    return 0;
  }

  let released = 0;
  const now = new Date().toISOString();

  for (const claim of meshState.claims) {
    if (claim.agentId === sessionId && claim.status === 'active') {
      claim.status = 'released';
      claim.lastUpdate = now;
      released++;
    }
  }

  if (released > 0) {
    try {
      writeFileSync(meshStatePath, JSON.stringify(meshState, null, 2), 'utf-8');
    } catch {
      // Non-critical
    }
  }

  return released;
}

function markSessionEnded(cwd: string, sessionId: string): void {
  const sessionsPath = join(cwd, '.cortivex', 'mesh', 'sessions.json');
  if (!existsSync(sessionsPath)) {
    return;
  }

  try {
    const raw = readFileSync(sessionsPath, 'utf-8');
    const sessions = JSON.parse(raw) as SessionRecord[];
    const now = new Date().toISOString();

    for (const session of sessions) {
      if (session.sessionId === sessionId && !session.endedAt) {
        session.endedAt = now;
      }
    }

    writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2), 'utf-8');
  } catch {
    // Non-critical
  }
}

async function main(): Promise<void> {
  let rawInput = '';

  try {
    rawInput = readFileSync(0, 'utf-8');
  } catch {
    process.exit(0);
  }

  if (!rawInput.trim()) {
    const result: SessionEndResult = { continue: true };
    process.stdout.write(JSON.stringify(result));
    return;
  }

  let input: HookInput;
  try {
    input = JSON.parse(rawInput) as HookInput;
  } catch {
    const result: SessionEndResult = { continue: true };
    process.stdout.write(JSON.stringify(result));
    return;
  }

  const cwd = process.cwd();
  const sessionId = input.data?.session_id ?? '';

  if (sessionId) {
    // Release all active mesh claims for this session
    releaseClaims(cwd, sessionId);

    // Mark the session as ended
    markSessionEnded(cwd, sessionId);
  }

  const result: SessionEndResult = { continue: true };
  process.stdout.write(JSON.stringify(result));
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ continue: true }));
});
