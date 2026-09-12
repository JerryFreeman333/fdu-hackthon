import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = await mkdtemp(join(tmpdir(), 'ankang-adapter-test-'));
const testFile = join(temp, 'tests', 'healthkit-device-adapter.test.js');
try {
  const compileCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        'node_modules/typescript/bin/tsc',
        '--target',
        'ES2020',
        '--module',
        'CommonJS',
        '--moduleResolution',
        'Node',
        '--esModuleInterop',
        '--skipLibCheck',
        '--types',
        'node',
        '--lib',
        'ES2020,DOM,DOM.Iterable',
        '--rootDir',
        '.',
        '--outDir',
        temp,
        'tests/healthkit-device-adapter.test.ts',
      ],
      { stdio: 'inherit' },
    );
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (compileCode !== 0) throw new Error(`HealthKit adapter test compilation failed with exit code ${compileCode}`);
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [testFile], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  await rm(temp, { recursive: true, force: true });
}
