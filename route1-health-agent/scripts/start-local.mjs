import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const projectDir = fileURLToPath(new URL('..', import.meta.url));
const siteUrl = 'http://127.0.0.1:5173/';
async function ready() {
  try {
    const response = await fetch(`${siteUrl}api/agent/status`, { signal: AbortSignal.timeout(1000) });
    return response.ok && typeof (await response.json()).configured === 'boolean';
  } catch {
    return false;
  }
}

if (await ready()) {
  console.log(`Assistant already running: ${siteUrl}`);
} else {
  const vitePath = join(projectDir, 'node_modules/vite/bin/vite.js');
  if (!existsSync(vitePath)) throw new Error('Dependencies missing. Run npm ci first.');
  const logDir = join(projectDir, '.local');
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `server-${Date.now()}.log`);
  const log = openSync(logPath, 'a');
  // Detach from the terminal; bind only to this computer, without installing a system service.
  const child = spawn(process.execPath, [vitePath, '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: projectDir,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  let failed = false;
  child.on('error', () => {
    failed = true;
  });
  child.on('exit', () => {
    failed = true;
  });
  child.unref();
  let started = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (failed) break;
    if (await ready()) {
      started = true;
      break;
    }
    await setTimeout(300);
  }
  if (!started) throw new Error(`Assistant did not start. See ${logPath}`);
  console.log(`Assistant ready: ${siteUrl} (PID ${child.pid})`);
  console.log(`Startup log: ${logPath}`);
}
