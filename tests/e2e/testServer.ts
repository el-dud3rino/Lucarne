import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export interface TestServerInstance {
  url: string;
  port: number;
  stop: () => Promise<void>;
}

export async function startTestServer(preferredPort = 4055): Promise<TestServerInstance> {
  const serverPath = path.resolve('dist/server/server/index.js');
  const port = preferredPort;
  // Isolated throwaway data dir per run so E2E never touches the real ./data database
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-e2e-'));
  const cleanup = () => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

  const child: ChildProcess = spawn(
    process.execPath,
    ['--no-warnings', serverPath],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: dataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const url = `http://localhost:${port}`;

  // Wait until server responds to /api/health
  const deadline = Date.now() + 15000;
  let ready = false;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // wait and retry
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!ready) {
    child.kill('SIGKILL');
    cleanup();
    throw new Error(`Test server failed to start on ${url} within 15 seconds`);
  }

  return {
    url,
    port,
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child.on('close', () => resolve());
        setTimeout(resolve, 1000);
      });
      try { cleanup(); } catch { /* Windows may briefly hold file locks */ }
    },
  };
}
