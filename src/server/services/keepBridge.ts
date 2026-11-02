import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DB_PATH } from '../db/connection.js';

/** Runs the Python keep-bridge (keep-bridge/keep_bridge.py), one process per command. */

export const KEEP_DIR = path.join(path.dirname(DB_PATH), 'keep');
const BRIDGE_TIMEOUT_MS = 90_000;

export type BridgeCommand = 'notes' | 'read' | 'apply' | 'create_list';

export class KeepBridgeError extends Error {
  constructor(
    public kind: string,
    message: string
  ) {
    super(message);
  }
}

export function readKeepEmail(): string | null {
  try {
    const creds = JSON.parse(fs.readFileSync(path.join(KEEP_DIR, 'credentials.json'), 'utf8'));
    return typeof creds.email === 'string' ? creds.email : null;
  } catch {
    return null;
  }
}

export function isKeepConfigured(): boolean {
  return Boolean(process.env.KEEP_BRIDGE_CMD) || fs.existsSync(path.join(KEEP_DIR, 'credentials.json'));
}

function bridgeCommand(): { cmd: string; args: string[] } {
  if (process.env.KEEP_BRIDGE_CMD) {
    const parts = JSON.parse(process.env.KEEP_BRIDGE_CMD) as string[];
    return { cmd: parts[0], args: parts.slice(1) };
  }
  const isWin = process.platform === 'win32';
  const venvPython = path.resolve('keep-bridge/.venv', isWin ? 'Scripts/python.exe' : 'bin/python');
  const python = fs.existsSync(venvPython)
    ? venvPython
    : process.env.KEEP_PYTHON || (isWin ? 'python' : 'python3');
  return { cmd: python, args: [path.resolve('keep-bridge/keep_bridge.py')] };
}

export function runBridge<T = any>(command: BridgeCommand, payload?: unknown): Promise<T> {
  const { cmd, args } = bridgeCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args, command], {
      env: { ...process.env, DATA_DIR: path.dirname(DB_PATH), PYTHONIOENCODING: 'utf-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new KeepBridgeError('timeout', `Keep bridge timed out after ${BRIDGE_TIMEOUT_MS / 1000}s`));
    }, BRIDGE_TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new KeepBridgeError('spawn', `Could not start the Keep bridge (${err.message}). Run: npm run keep:setup`));
    });
    child.on('close', () => {
      clearTimeout(timer);
      let parsed: any;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        const tail = (stderr || stdout).trim().split('\n').slice(-3).join(' ');
        return reject(new KeepBridgeError('bridge', `Keep bridge returned no result. ${tail}`.trim()));
      }
      if (!parsed.ok) return reject(new KeepBridgeError(parsed.error || 'bridge', parsed.message || 'Keep bridge error'));
      resolve(parsed as T);
    });
    child.stdin.end(payload === undefined ? '' : JSON.stringify(payload));
  });
}
