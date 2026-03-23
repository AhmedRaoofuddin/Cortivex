/**
 * Session Start Hook — SessionStart
 *
 * Initializes the Cortivex session when Claude Code starts.
 * Loads project configuration, verifies the .cortivex/ directory exists,
 * and prepares the mesh state for the session.
 *
 * Claude Code passes the hook context as JSON on stdin.
 * Expected input shape:
 *   { event: "SessionStart", data: { session_id?: string, cwd?: string } }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface HookInput {
  event: string;
  data: {
    session_id?: string;
    cwd?: string;
    [key: string]: unknown;
  };
}

interface CortivexConfig {
  version: string;
  defaultModel: string;
  failureStrategy: string;
  maxRetries: number;
  parallelism: number;
  timeout: number;
  [key: string]: unknown;
}

interface SessionRecord {
  sessionId: string;
  startedAt: string;
  cwd: string;
  configLoaded: boolean;
}

interface SessionStartResult {
  continue: boolean;
  message?: string;
}

function loadConfig(cortivexDir: string): CortivexConfig | null {
  const configPath = join(cortivexDir, 'config.json');
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as CortivexConfig;
  } catch {
    return null;
  }
}

function registerSession(cortivexDir: string, record: SessionRecord): void {
  const sessionsPath = join(cortivexDir, 'mesh', 'sessions.json');
  let sessions: SessionRecord[] = [];

  try {
    if (existsSync(sessionsPath)) {
      const raw = readFileSync(sessionsPath, 'utf-8');
      sessions = JSON.parse(raw) as SessionRecord[];
    }
  } catch {
    sessions = [];
  }

  sessions.push(record);

  // Keep only the last 50 sessions
  if (sessions.length > 50) {
    sessions = sessions.slice(-50);
  }

  try {
    const meshDir = join(cortivexDir, 'mesh');
    mkdirSync(meshDir, { recursive: true });
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
    const result: SessionStartResult = { continue: true };
    process.stdout.write(JSON.stringify(result));
    return;
  }

  let input: HookInput;
  try {
    input = JSON.parse(rawInput) as HookInput;
  } catch {
    const result: SessionStartResult = { continue: true };
    process.stdout.write(JSON.stringify(result));
    return;
  }

  const cwd = input.data?.cwd ?? process.cwd();
  const cortivexDir = join(cwd, '.cortivex');
  const sessionId = input.data?.session_id ?? `session_${Date.now()}`;

  // Check if Cortivex is initialized
  if (!existsSync(cortivexDir)) {
    const result: SessionStartResult = {
      continue: true,
      message: 'Cortivex is not initialized in this project. Run "cortivex init" to set up.',
    };
    process.stdout.write(JSON.stringify(result));
    return;
  }

  // Load and validate configuration
  const config = loadConfig(cortivexDir);
  const configLoaded = config !== null;

  if (!configLoaded) {
    const result: SessionStartResult = {
      continue: true,
      message: 'Cortivex config.json is missing or invalid. Run "cortivex init --force" to recreate.',
    };
    process.stdout.write(JSON.stringify(result));
    return;
  }

  // Ensure mesh directory exists
  const meshDir = join(cortivexDir, 'mesh');
  if (!existsSync(meshDir)) {
    try {
      mkdirSync(meshDir, { recursive: true });
    } catch {
      // Non-critical
    }
  }

  // Register this session
  registerSession(cortivexDir, {
    sessionId,
    startedAt: new Date().toISOString(),
    cwd,
    configLoaded,
  });

  const result: SessionStartResult = {
    continue: true,
    message: `Cortivex session initialized (model: ${config.defaultModel}, parallelism: ${config.parallelism}).`,
  };
  process.stdout.write(JSON.stringify(result));
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ continue: true }));
});
