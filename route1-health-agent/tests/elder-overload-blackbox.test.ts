import { generateAgentReply, ruleBasedAdapter } from '../src/engine/agent';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';
import { createTaskFromFinding } from '../src/engine/tasks';
import type { Finding } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runCase(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS: ${name}`));
}

const TODAY = '2026-09-08';

async function main() {
  await runCase('overloaded speech keeps self facts separate from family facts and context', () => {
    const input = understandElderInput(
      '我今天头晕，昨晚没睡好，早上药忘了吃，我爸摔了一下，女儿也没在家，我现在其实没什么事',
      TODAY,
    );
    const selfClaims = acceptedSelfClaims(input);
    const fatherClaims = input.claims.filter((claim) => claim.subject === 'father');
    const contextOnlyFamily = input.claims.filter(
      (claim) => claim.subject === 'family_other' && claim.tags.length === 0 && !claim.hasHealthValue,
    );
    assert(selfClaims.length === 3, 'three self health facts should remain independently actionable');
    assert(fatherClaims.length === 1, 'one father health fact should remain in the family ledger candidate');
    assert(
      contextOnlyFamily.length === 1,
      'non-health family context may be retained internally without becoming a health fact',
    );
    assert(!selfClaims.some((claim) => claim.tags.includes('fall')), 'family fall must not enter self health facts');
  });

  await runCase('overloaded safety reply preserves more than one immediately useful action', async () => {
    const reply = await generateAgentReply(
      '我今天头晕，早上药忘了吃',
      ['dizziness', 'medicationMissed'],
      [],
      false,
      undefined,
      ruleBasedAdapter,
    );
    assert(reply.includes('先坐稳'), 'dizziness safety guidance should remain visible');
    assert(reply.includes('别自行加量补吃'), 'missed-medication guidance should remain visible');
  });

  await runCase('actionable tasks stay bounded when many findings compete', () => {
    const findings: Finding[] = [
      {
        id: 'f1',
        date: TODAY,
        severity: 'urgent',
        title: '立即确认安全',
        detail: 'urgent',
        evidence: [],
        carePath: '先确认当前安全。',
        familyEligible: false,
      },
      {
        id: 'f2',
        date: TODAY,
        severity: 'alert',
        title: '需要关注',
        detail: 'alert',
        evidence: [],
        carePath: '今天确认一次。',
        familyEligible: false,
      },
      {
        id: 'f3',
        date: TODAY,
        severity: 'alert',
        title: '不应挤进首屏',
        detail: 'alert',
        evidence: [],
        carePath: '稍后确认。',
        familyEligible: false,
      },
    ];
    const firstTwo = findings.slice(0, 2).map((finding) => createTaskFromFinding(finding, TODAY));
    assert(firstTwo.every(Boolean), 'top two findings should remain actionable');
    assert(firstTwo[0]?.title.includes('立即确认'), 'the urgent action should remain first');
    assert(firstTwo.length === 2, 'the elder-facing overload path should expose at most two first-priority tasks');
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
