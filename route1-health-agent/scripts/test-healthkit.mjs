import { spawn } from 'node:child_process';

for (const script of ['scripts/test-healthkit-bridge.mjs', 'scripts/test-healthkit-adapter.mjs']) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    break;
  }
}
