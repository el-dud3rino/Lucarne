// Bundles an already-built Lucarne (npm run build) into release/lucarne-v<version>.tar.gz.
// The archive holds everything needed to run without building: install it with  npm ci --omit=dev
// Usage: npm run build && npm run package
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const name = `lucarne-v${pkg.version}`;
const outDir = path.resolve('release');
const stage = path.join(outDir, name);

if (!fs.existsSync('dist/client/index.html') || !fs.existsSync('dist/server/server/index.js')) {
  console.error('dist/ is missing or incomplete. Run  npm run build  first.');
  process.exit(1);
}

const include = [
  'dist',
  'deploy',
  'keep-bridge/keep_bridge.py',
  'keep-bridge/login.py',
  'keep-bridge/requirements.txt',
  'scripts/keep-setup.mjs',
  'scripts/keep-login.mjs',
  'package.json',
  'package-lock.json',
  '.env.example',
  'README.md',
  'LICENSE',
];

fs.rmSync(stage, { recursive: true, force: true });
for (const rel of include) {
  if (!fs.existsSync(rel)) {
    console.error(`Missing ${rel}`);
    process.exit(1);
  }
  fs.cpSync(rel, path.join(stage, rel), { recursive: true });
}

const archive = `${name}.tar.gz`;
const r = spawnSync('tar', ['-czf', archive, name], { cwd: outDir, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
fs.rmSync(stage, { recursive: true, force: true });
console.log(`Wrote release/${archive}`);
