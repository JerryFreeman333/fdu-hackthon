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

const sameDayPrivateAfterShare = {
  id: 'obs-same-day-private-after-share',
  date: TODAY,
  source: 'chat' as const,
  text: '我后来又摔了一下，这次先别告诉孩子们',
  tags: ['fall' as const],
  visibility: 'private' as const,
};

const latestPrivateFindings = runDetection(
  [observationToEvent(currentFamilyOkFall), observationToEvent(sameDayPrivateAfterShare)],
  TODAY,
);
const latestPrivateFall = latestPrivateFindings.find((finding) => finding.ruleId === 'safety.fall');
assert(Boolean(latestPrivateFall), '同一天后续私密跌倒仍应生成老人侧安全发现');
assert(latestPrivateFall?.familyEligible === false, '后续私密跌倒应覆盖较早的可分享跌倒隐私范围');
assert(latestPrivateFall?.familyMessage === undefined, '后续私密跌倒不得继续暴露家属提示');

const latestShareableFindings = runDetection(
  [observationToEvent(sameDayPrivateAfterShare), observationToEvent(currentFamilyOkFall)],
  TODAY,
);
const latestShareableFall = latestShareableFindings.find((finding) => finding.ruleId === 'safety.fall');
assert(Boolean(latestShareableFall), '后续明确可分享的跌倒仍应生成老人侧安全发现');
assert(latestShareableFall?.familyEligible === true, '后续明确同意分享的跌倒应重新获得家属协同资格');
assert(Boolean(latestShareableFall?.familyMessage), '后续明确可分享的跌倒应生成家属提示');

console.log('PASS: historical and same-day fall privacy follows the latest matching observation');
