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

const sensitiveClientStateFiles = [
  'src/App.tsx',
  'src/hooks/useFamilyBinding.ts',
  'src/hooks/useCareTasks.ts',
  'src/components/FamilyDashboard.tsx',
  'src/components/RoleGate.tsx',
  'src/store/LocalHealthRecordStore.ts',
];

for (const relativePath of sensitiveClientStateFiles) {
  const path = join(ROOT, relativePath);
  const text = readFileSync(path, 'utf8');
  if (/localStorage\.(?:getItem|setItem|removeItem)\(/.test(text)) {
    policyFindings.push(`${relativePath}: sensitive session/health state must not persist through localStorage`);
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

console.log(
  'Security check passed: no obvious hard-coded API keys/private keys and no sensitive session/health state persisted in localStorage.',
);
