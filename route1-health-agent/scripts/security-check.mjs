import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const findings = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.test-build' || name === '.git') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
    } else if (/\.(ts|tsx|js|mjs|json|html|css|md)$/.test(name)) {
      const text = readFileSync(path, 'utf8');
      if (
        /\b(sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)\b/.test(text)
      ) {
        findings.push(path);
      }
    }
  }
}

walk(ROOT);

if (findings.length) {
  console.error('Potential hard-coded secret detected:');
  for (const file of findings) console.error(` - ${file}`);
  process.exit(1);
}

console.log('Security check passed: no obvious hard-coded API keys or private keys found.');
