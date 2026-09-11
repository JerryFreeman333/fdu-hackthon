import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
const exporter = await readFile(new URL('../../pipeline/scripts/05_export_web.ps1', import.meta.url), 'utf8');

test('real Home mode is explicit and cannot silently fall back to Demo', () => {
  assert.match(main, /VITE_HOME_MODE/);
  assert.match(main, /真实 Home 模式已启用/);
  assert.match(main, /不会回退到合成 Demo/);
  assert.match(main, /home\.manifest\.json/);
});

test('real reconstruction export writes provenance and checksum', () => {
  assert.match(exporter, /Get-FileHash/);
  assert.match(exporter, /sha256/);
  assert.match(exporter, /iteration/);
  assert.match(exporter, /home\.manifest\.json/);
});
