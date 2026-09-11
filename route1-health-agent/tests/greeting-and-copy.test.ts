import { parseElderInput } from '../src/engine/agent';
import { parsePrivacyIntent } from '../src/engine/privacy';
import { understandElderInput } from '../src/engine/understanding';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TODAY = '2026-09-11';

// P2-3 回归：问候与道谢是社交表达，不再被当成"没听清"。
const greeting = understandElderInput('你好', TODAY);
assert(greeting.claims.length === 0, 'greeting must not create claims');
assert(
  Boolean(greeting.clarificationQuestion?.includes('我在呢')),
  `greeting should get a warm reply, got ${greeting.clarificationQuestion}`,
);

const thanks = understandElderInput('谢谢您', TODAY);
assert(
  Boolean(thanks.clarificationQuestion?.includes('不客气')),
  `thanks should get a warm reply, got ${thanks.clarificationQuestion}`,
);

// 带健康内容的句子不受问候分支影响。
const greetingWithSymptom = understandElderInput('你好，我头晕', TODAY);
assert(
  !greetingWithSymptom.clarificationQuestion &&
    greetingWithSymptom.claims.some((claim) => claim.tags.includes('dizziness')),
  'symptom content after a greeting must still be recorded',
);

// 无健康信号的闲聊：给温和引导，不再出现"该该"错字或宣称没听清。
const smallTalk = understandElderInput('今天天气不错', TODAY);
assert(
  Boolean(smallTalk.clarificationQuestion?.includes('我在听')),
  `small talk should get a soft guide, got ${smallTalk.clarificationQuestion}`,
);
assert(
  !smallTalk.clarificationQuestion?.includes('该该') && !smallTalk.clarificationQuestion?.includes('没有听清'),
  'old garbled copy must be gone',
);

// P2-3 回归：带问号的"胸闷？"是提问，不是错字确认，更不是症状陈述。
const chestQuestion = understandElderInput('胸闷？', TODAY);
assert(chestQuestion.claims.length === 0, 'a question about chest tightness must not be recorded as a symptom');
assert(
  Boolean(chestQuestion.clarificationQuestion?.includes('还是想说您现在有胸闷')),
  `question should ask user intent, got ${chestQuestion.clarificationQuestion}`,
);

// 语音错字"凶闷"仍需确认，且确认文案指向"胸闷"。
const typo = understandElderInput('有点凶闷', TODAY);
assert(Boolean(typo.clarificationQuestion?.includes('胸闷')), 'ASR typo must ask whether it means 胸闷');
assert(parseElderInput('有点凶闷').tags.length === 0, 'typo must not be silently normalized as a symptom');

// 健康信号判据更新后，常见表达不被误判为听不清。
const negation = understandElderInput('今天倒是没喘，也没胸闷', TODAY);
assert(
  !negation.clarificationQuestion?.includes('我在听') || negation.claims.length > 0,
  'negated symptoms should not be treated as small talk',
);
assert(parsePrivacyIntent('我想让儿子回来一趟') === 'none', 'sanity: unrelated regex changes stay contained');

console.log('PASS: greeting, small-talk, and copy regression suite');
