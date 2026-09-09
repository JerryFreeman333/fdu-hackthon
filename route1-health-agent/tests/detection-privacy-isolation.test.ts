import { observationToEvent } from '../src/pipeline/events';
import { runDetection } from '../src/engine/detect';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TODAY = '2026-09-08';

const oldPrivateFall = {
  id: 'obs-old-private-fall',
  date: '2026-09-01',
  source: 'chat' as const,
  text: '上周摔了一下，先别告诉孩子们',
  tags: ['fall' as const],
  visibility: 'private' as const,
};

const currentFamilyOkFall = {
  id: 'obs-current-family-fall',
  date: TODAY,
  source: 'chat' as const,
  text: '我今天又摔了一下，可以告诉孩子们',
  tags: ['fall' as const],
  visibility: 'family_ok' as const,
};

const mixedFindings = runDetection(
  [observationToEvent(oldPrivateFall), observationToEvent(currentFamilyOkFall)],
  TODAY,
);
const mixedFall = mixedFindings.find((finding) => finding.ruleId === 'safety.fall');

assert(Boolean(mixedFall), '应生成当前跌倒发现');
assert(mixedFall?.severity === 'urgent', '当前跌倒应保持紧急级别');
assert(mixedFall?.familyEligible === true, '当前明确同意分享的跌倒不得被历史隐私记录屏蔽');
assert(Boolean(mixedFall?.familyMessage), '当前可分享跌倒应生成家属提示');

const privateFindings = runDetection([observationToEvent(oldPrivateFall)], '2026-09-01');
const privateFall = privateFindings.find((finding) => finding.ruleId === 'safety.fall');

assert(Boolean(privateFall), '私密跌倒仍应生成老人侧安全发现');
assert(privateFall?.familyEligible === false, '私密跌倒不得通知家属');
assert(privateFall?.familyMessage === undefined, '私密跌倒不得暴露家属提示');

console.log('PASS: 历史私密跌倒不会屏蔽当前可分享的紧急跌倒');
