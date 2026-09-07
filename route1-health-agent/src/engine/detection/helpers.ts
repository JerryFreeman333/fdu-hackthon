import type { Finding } from '../../types';

export function addFinding(findings: Finding[], input: Omit<Finding, 'id'>): Finding {
  const ruleId = input.ruleId ?? 'finding';
  const finding = { ...input, id: `${ruleId}-${input.date}` };
  findings.push(finding);
  return finding;
}
