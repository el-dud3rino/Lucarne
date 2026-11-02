// Runs the interactive Google Keep login using the keep-bridge virtualenv.
// Usage: npm run keep:login   (run in your own terminal; it asks for a secret token)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const isWin = process.platform === 'win32';
const venvPython = path.resolve('keep-bridge/.venv', isWin ? 'Scripts/python.exe' : 'bin/python');
if (!fs.existsSync(venvPython)) {
  console.error('Keep bridge is not set up yet. Run: npm run keep:setup');
  process.exit(1);
}
const r = spawnSync(venvPython, ['keep-bridge/login.py'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
