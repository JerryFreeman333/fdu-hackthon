import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const findings = [];
const policyFindings = [];

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

const authBoundaryFiles = [
  'src/App.tsx',
  'src/hooks/useFamilyBinding.ts',
  'src/components/FamilyDashboard.tsx',
  'src/components/RoleGate.tsx',
];

for (const relativePath of authBoundaryFiles) {
  const path = join(ROOT, relativePath);
  const text = readFileSync(path, 'utf8');
  if (/localStorage\.(?:getItem|setItem|removeItem)\(/.test(text)) {
    policyFindings.push(`${relativePath}: security-sensitive role/authorization UI must not persist localStorage state`);
  }
}

if (findings.length) {
  console.error('Potential hard-coded secret detected:');
  for (const file of findings) console.error(` - ${file}`);
  process.exit(1);
}

if (policyFindings.length) {
  console.error('Security boundary policy violation:');
  for (const finding of policyFindings) console.error(` - ${finding}`);
  process.exit(1);
}

console.log('Security check passed: no obvious hard-coded API keys/private keys and no persisted auth boundary state found.');
