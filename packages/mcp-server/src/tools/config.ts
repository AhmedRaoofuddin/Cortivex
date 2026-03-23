/**
 * cortivex_config — Get or set Cortivex configuration values.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ConfigInput {
  action: 'get' | 'set';
  key?: string;
  value?: unknown;
}

const CONFIG_DIR = '.cortivex';
const CONFIG_FILE = 'config.json';

function getConfigPath(): string {
  return path.resolve(process.cwd(), CONFIG_DIR, CONFIG_FILE);
}

function loadConfig(): Record<string, unknown> {
  const configPath = getConfigPath();
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function saveConfig(config: Record<string, unknown>): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export async function configTool(input: ConfigInput): Promise<{ content: Array<{ type: string; text: string }> }> {
  const action = input.action ?? 'get';

  if (action === 'get') {
    const config = loadConfig();

    if (input.key) {
      const value = config[input.key];
      if (value === undefined) {
        return {
          content: [{
            type: 'text',
            text: `Configuration key "${input.key}" is not set.\n\nAvailable keys: ${Object.keys(config).join(', ') || 'none (config is empty)'}`,
          }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: `${input.key} = ${JSON.stringify(value, null, 2)}`,
        }],
      };
    }

    // Return all config
    if (Object.keys(config).length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No configuration found. Run cortivex init to create a default configuration, or use cortivex_config with action "set" to set values.',
        }],
      };
    }

    const lines = Object.entries(config).map(
      ([k, v]) => `  ${k} = ${JSON.stringify(v)}`,
    );
    return {
      content: [{
        type: 'text',
        text: `Cortivex Configuration:\n${lines.join('\n')}`,
      }],
    };
  }

  if (action === 'set') {
    if (!input.key || input.key.trim() === '') {
      return {
        content: [{
          type: 'text',
          text: 'Error: A configuration key is required when action is "set".',
        }],
      };
    }

    const config = loadConfig();
    config[input.key] = input.value;
    saveConfig(config);

    return {
      content: [{
        type: 'text',
        text: `Configuration updated:\n  ${input.key} = ${JSON.stringify(input.value)}`,
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: `Invalid action "${action}". Use "get" or "set".`,
    }],
  };
}
