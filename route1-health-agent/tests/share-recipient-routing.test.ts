import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';
import { canShareWithFamily, parsePrivacyIntent } from '../src/engine/privacy';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TODAY = '2026-09-11';

// P1-2 回归 A：分享句式里的称谓是“接收人”，老人的事实必须回到本人档案
// （此前“跟女儿说今天走了六千步”被误归家人账本，本人步数丢失且被错误共享）。
const stepsInput = understandElderInput('跟女儿说今天走了六千步', TODAY);
const stepsClaim = acceptedSelfClaims(stepsInput)[0];
assert(stepsClaim, '“跟女儿说今天走了六千步”必须按本人事实接收');
assert(stepsClaim.hasHealthValue, '本人事实应携带结构化数值');
assert(!stepsInput.claims.some((claim) => claim.subject === 'family_other'), '不得再产生家人事实');

// 转述家人的事实仍然归家人；接收人不参与主体判定。
const motherFall = understandElderInput('告诉女儿妈妈摔倒了', TODAY);
assert(
  motherFall.claims.some((claim) => claim.subject === 'mother' && claim.tags.includes('fall')),
  '“告诉女儿妈妈摔倒了”应把摔倒归到妈妈',
);

// 没有分享动词时，称谓开头仍是家人事实。
const daughterDizzy = understandElderInput('女儿今天头晕', TODAY);
assert(
  daughterDizzy.claims.some((claim) => claim.subject === 'family_other' && claim.tags.includes('dizziness')),
  '“女儿今天头晕”应归到女儿',
);

// 分享句式剩余部分指向第三人称时保持 unknown，等待澄清而不是猜测。
const pronounInput = understandElderInput('跟女儿说她不舒服', TODAY);
assert(
  pronounInput.claims.some((claim) => claim.subject === 'unknown'),
  '“跟女儿说她不舒服”不得默认成本人事实',
);

// P1-2 回归 B：跟/让 必须接到“说/讲/知道”才是分享意图
// （此前“我想让儿子回来一趟”被判为 share_family，绕过 denied 授权）。
assert(parsePrivacyIntent('我想让儿子回来一趟') === 'none', '“让儿子回来一趟”不是分享意图');
assert(
  canShareWithFamily('denied', parsePrivacyIntent('我想让儿子回来一趟')) === false,
  'denied 授权下不得因误判而共享',
);
assert(parsePrivacyIntent('跟女儿说今天走了六千步') === 'share_family', '明确的“跟女儿说”仍是分享意图');
assert(parsePrivacyIntent('告诉女儿我今晚头晕') === 'share_family', '告诉女儿仍是分享意图');
assert(parsePrivacyIntent('我想告诉女儿') === 'share_family', '明确的分享请求保持不变');
assert(parsePrivacyIntent('这次告诉女儿') === 'share_family', '简短的分享请求保持不变');
assert(canShareWithFamily('denied', 'share_family') === true, '明确的分享意图仍可一次性共享');

console.log('PASS: share recipient routing and privacy intent regression suite');
