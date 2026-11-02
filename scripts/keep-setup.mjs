// Creates an isolated Python venv for the Google Keep bridge and installs its dependencies.
// Usage: npm run keep:setup   (set KEEP_PYTHON to override the base interpreter)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const isWin = process.platform === 'win32';
const basePython = process.env.KEEP_PYTHON || (isWin ? 'python' : 'python3');
const venvDir = path.resolve('keep-bridge/.venv');
const venvPython = isWin ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\nFailed: ${cmd} ${args.join(' ')}`);
    if (!isWin) console.error('On Raspberry Pi OS / Debian you may need: sudo apt install python3-venv');
    process.exit(r.status ?? 1);
  }
}

if (!fs.existsSync(venvPython)) run(basePython, ['-m', 'venv', venvDir]);
run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', 'keep-bridge/requirements.txt']);
console.log('\nKeep bridge ready. Next: link your account with  npm run keep:login');
