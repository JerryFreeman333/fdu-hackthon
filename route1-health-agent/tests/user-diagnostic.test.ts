import { generateAgentReply, parseElderInput, ruleBasedAdapter } from '../src/engine/agent';
import { extractHealthValues } from '../src/engine/extract';
import { acceptedSelfClaims, hasDeathReport, understandElderInput } from '../src/engine/understanding';
import type { ChatMessage } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runCase(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS: ${name}`));
}

const TODAY = '2026-09-06';

async function main() {
  await runCase('spouse fall does not become elder fact', () => {
    const input = understandElderInput('我老公今天摔了一跤', TODAY);
    assert(input.claims[0]?.subject === 'spouse', 'subject should be spouse');
    assert(acceptedSelfClaims(input).length === 0, 'spouse fall must not be accepted as self fact');
  });

  await runCase('negated self fall is not accepted', () => {
    const input = understandElderInput('我没摔倒', TODAY);
    assert(input.claims[0]?.status === 'negated', 'claim should be negated');
    assert(acceptedSelfClaims(input).length === 0, 'negated fall must not be accepted');
  });

  await runCase('hypothetical fall is not recorded', () => {
    const input = understandElderInput('如果我摔倒怎么办', TODAY);
    assert(input.claims[0]?.status === 'hypothetical', 'claim should be hypothetical');
    assert(acceptedSelfClaims(input).length === 0, 'hypothetical fall must not be accepted');
  });

  await runCase('historical fall is not rewritten as today', () => {
    const input = understandElderInput('我去年摔过一次', TODAY);
    assert(input.claims[0]?.timeScope === 'historical', 'claim should be historical');
    assert(input.claims[0]?.eventDate === null, 'historical claim must not invent an event date');
    assert(acceptedSelfClaims(input).length === 0, 'historical fall must not enter today detection');
  });

  await runCase('mixed self and spouse sentence is split by person', () => {
    const input = understandElderInput('我没摔倒，是我老公摔了', TODAY);
    assert(input.claims.length >= 2, 'mixed statement should produce multiple claims');
    assert(
      input.claims[0]?.subject === 'self' && input.claims[0]?.status === 'negated',
      'self denial should stay separate',
    );
    assert(
      input.claims[1]?.subject === 'spouse' && input.claims[1]?.status === 'occurred',
      'spouse event should stay separate',
    );
    assert(acceptedSelfClaims(input).length === 0, 'mixed statement must not create self fall fact');
  });

  await runCase('death report is not treated as ordinary fall', () => {
    const input = understandElderInput('我爸跌死了', TODAY);
    assert(hasDeathReport(input), 'death outcome should be detected');
    assert(input.claims[0]?.subject === 'father', 'death report should belong to father');
    assert(acceptedSelfClaims(input).length === 0, 'family death report must not enter self health facts');
  });

  await runCase('prior pronoun stays ambiguous when multiple family members exist', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'elder', text: '我老公走路不稳', time: '09-05 10:00' },
      { id: '2', role: 'elder', text: '我爸也不舒服', time: '09-05 10:01' },
    ];
    const input = understandElderInput('他摔了', TODAY, messages);
    assert(input.claims[0]?.subject === 'unknown', 'pronoun should remain ambiguous');
    assert(Boolean(input.clarificationQuestion), 'ambiguous pronoun should trigger clarification');
  });

  await runCase('negated discomfort is not accepted', () => {
    const input = understandElderInput('我没有不舒服', TODAY);
    assert(input.claims[0]?.tags.includes('pain'), 'discomfort should still be recognized as the pain tag');
    assert(input.claims[0]?.status === 'negated', 'negated discomfort should be negated');
    assert(acceptedSelfClaims(input).length === 0, 'negated discomfort must not be accepted');

    const selfInput = understandElderInput('我自己没有不舒服', TODAY);
    assert(selfInput.claims[0]?.status === 'negated', 'explicit self wording should also be negated');
  });

  await runCase('actual discomfort remains occurred', () => {
    const input = understandElderInput('我今天有点不舒服', TODAY);
    assert(input.claims[0]?.tags.includes('pain'), 'actual discomfort should keep pain tag');
    assert(input.claims[0]?.status === 'occurred', 'actual discomfort must remain occurred');
    assert(acceptedSelfClaims(input).length === 1, 'actual discomfort should still be accepted');
  });

  await runCase('coordinated self and spouse facts are split instead of becoming unknown', () => {
    const input = understandElderInput('我和老伴都没吃药', TODAY);
    assert(input.claims.length === 2, 'coordinated statement should become two claims');
    assert(
      input.claims.every((claim) => claim.status === 'occurred' && claim.tags.includes('medicationMissed')),
      'missed medication is an occurred event for both people',
    );
    assert(input.claims[0]?.subject === 'self', 'first coordinated subject should be self');
    assert(input.claims[1]?.subject === 'spouse', 'second coordinated subject should be spouse');
    assert(acceptedSelfClaims(input).length === 1, 'only the self claim enters the elder health stream');
  });

  await runCase('coordinated denial is copied to both explicit subjects', () => {
    const input = understandElderInput('我和老伴都没有胸痛', TODAY);
    assert(input.claims.length === 2, 'coordinated denial should become two claims');
    assert(
      input.claims.every((claim) => claim.status === 'negated'),
      'both subjects should be negated',
    );
    assert(input.claims[0]?.subject === 'self', 'self denial should stay self');
    assert(input.claims[1]?.subject === 'spouse', 'spouse denial should stay spouse');
    assert(acceptedSelfClaims(input).length === 0, 'negated self denial must not enter the health stream');
  });

  await runCase('coordinated occurred symptom is split without leaking spouse into self', () => {
    const input = understandElderInput('我和老伴都喘', TODAY);
    assert(input.claims.length === 2, 'coordinated symptom should become two claims');
    assert(
      input.claims[0]?.subject === 'self' && input.claims[0]?.status === 'occurred',
      'self dyspnea claim should occur',
    );
    assert(
      input.claims[1]?.subject === 'spouse' && input.claims[1]?.status === 'occurred',
      'spouse dyspnea claim should occur',
    );
    assert(acceptedSelfClaims(input).length === 1, 'only one self claim should be accepted');
  });

  await runCase('omitted parallel family action inherits the prior fact safely', () => {
    const input = understandElderInput('我没吃药，我爸也没吃', TODAY);
    assert(input.claims.length >= 2, 'parallel family action should preserve both claims');
    assert(
      input.claims.some(
        (claim) => claim.subject === 'self' && claim.tags.includes('medicationMissed') && claim.status === 'occurred',
      ),
      'self medication miss should remain recorded',
    );
    assert(
      input.claims.some(
        (claim) => claim.subject === 'father' && claim.tags.includes('medicationMissed') && claim.status === 'occurred',
      ),
      'father omitted medication miss should inherit the prior fact',
    );
    assert(acceptedSelfClaims(input).length === 1, 'only the self medication fact should enter self health events');
  });

  await runCase('mixed subjects keep their own state across explicit clauses', () => {
    const input = understandElderInput('我没胸痛，我老伴昨天胸闷', TODAY);
    assert(
      input.claims.some((claim) => claim.subject === 'self' && claim.status === 'negated'),
      'self chest-pain denial must stay negated',
    );
    assert(
      input.claims.some(
        (claim) => claim.subject === 'spouse' && claim.tags.includes('dyspnea') && claim.status === 'occurred',
      ),
      'spouse chest tightness must remain a spouse fact',
    );
    assert(acceptedSelfClaims(input).length === 0, 'self denial must not become an accepted symptom');
  });

  await runCase('mixed subjects preserve father measurement without contaminating self', () => {
    const input = understandElderInput('我没吃药，我爸血压180/110', TODAY);
    assert(
      input.claims.some((claim) => claim.subject === 'self' && claim.tags.includes('medicationMissed')),
      'self medication miss should remain',
    );
    assert(
      input.claims.some((claim) => claim.subject === 'father' && claim.hasHealthValue),
      'father blood pressure must remain a family measurement',
    );
    assert(
      acceptedSelfClaims(input).filter((claim) => claim.hasHealthValue).length === 0,
      'father measurement must never enter self events',
    );
  });

  await runCase('pure numeric measurement remains recordable', () => {
    const input = understandElderInput('我的血压 150/95', TODAY);
    const accepted = acceptedSelfClaims(input);
    assert(accepted.length === 1, 'numeric health claim should be accepted');
    assert(accepted[0]?.hasHealthValue === true, 'numeric claim should be marked as health value');
    assert(extractHealthValues('我的血压 150/95').length === 2, 'blood pressure should still extract');
  });

  await runCase('circle count is not converted to steps', () => {
    assert(extractHealthValues('今天走了三圈').length === 0, 'unknown circle-to-step conversion must not be invented');
  });

  await runCase('last night is assigned to the prior calendar date', () => {
    const input = understandElderInput('昨晚起夜三四次', TODAY);
    assert(input.claims[0]?.eventDate === '2026-09-05', 'last night should use previous date');
    assert(input.claims[0]?.timeScope === 'lastNight', 'last night should preserve time scope');
  });

  await runCase('fatigue reply does not invent activity decline', async () => {
    const reply = await generateAgentReply('我很累', ['fatigue'], [], false, undefined, ruleBasedAdapter);
    assert(!reply.includes('活动量比平时少'), 'fatigue reply must not invent activity decline');
  });

  await runCase('voice-facing parser still exposes raw wording', () => {
    const parsed = parseElderInput('有点凶闷');
    assert(parsed.tags.length === 0, 'ambiguous wording should not be silently normalized as a symptom');
    const input = understandElderInput('有点凶闷', TODAY);
    assert(Boolean(input.clarificationQuestion), 'ambiguous wording should trigger clarification');
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
