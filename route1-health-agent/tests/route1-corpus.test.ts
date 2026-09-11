import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedSelfClaims, understandElderInput, hasDeathReport } from '../src/engine/understanding';
import { extractHealthValues, extractBloodPressureValues } from '../src/engine/extract';
import { collectFamilyNotifications } from '../src/engine/escalate';
import { runDetection } from '../src/engine/detect';
import { generateAgentReply, ruleBasedAdapter } from '../src/engine/agent';

const TODAY = '2026-09-10';

function claimsOf(text: string) {
  return understandElderInput(text, TODAY).claims;
}

function selfAccepted(text: string) {
  return acceptedSelfClaims(understandElderInput(text, TODAY));
}

function familyClaimsOf(text: string) {
  return claimsOf(text).filter((c) => c.subject !== 'self' && c.subject !== 'unknown');
}

test('corpus: 我爸今天喘，后来我也喘了', () => {
  const c = claimsOf('我爸今天喘，后来我也喘了');
  // Expect father + self
  assert.equal(c.length, 2, '应拆成两条 claim');
  assert.equal(c[0]?.subject, 'father');
  assert.equal(c[0]?.status, 'occurred');
  assert.equal(c[0]?.tags[0], 'dyspnea');
  assert.equal(c[1]?.subject, 'self');
  assert.equal(c[1]?.tags[0], 'dyspnea');
  assert.equal(selfAccepted('我爸今天喘，后来我也喘了').length, 1, '本人的喘应进入本人事实流');
});

test('corpus: 我妈昨天胸闷，今天好多了', () => {
  const c = claimsOf('我妈昨天胸闷，今天好多了');
  // Expect mother claim + a follow-up improvement claim
  assert.equal(c[0]?.subject, 'mother');
  assert.equal(c[0]?.timeScope, 'yesterday');
  assert.equal(c[0]?.eventDate, '2026-09-09');
});

test('corpus: 我爸刚才摔了，我当时也吓了一跳', () => {
  const c = claimsOf('我爸刚才摔了，我当时也吓了一跳');
  assert.equal(c.length, 2, '应拆成两条');
  assert.equal(c[0]?.subject, 'father');
  assert.equal(c[0]?.tags[0], 'fall');
  assert.equal(selfAccepted('我爸刚才摔了，我当时也吓了一跳').length, 0, '不能因为“我”出现在吓一跳里就把摔倒归到本人');
});

test('corpus: 我觉得他好像不太舒服', () => {
  const c = claimsOf('我觉得他好像不太舒服');
  assert.equal(c[0]?.subject, 'family_other', '"他"应优先于"我"');
  assert.equal(c[0]?.status, 'uncertain', '"好像"应作 uncertain');
  assert.equal(selfAccepted('我觉得他好像不太舒服').length, 0);
});

test('corpus: 他昨天摔过，现在没事', () => {
  // 无上文代词时，"他" 不能随意归到 family_other（仍是 unknown）
  const c = claimsOf('他昨天摔过，现在没事');
  // 没有 prior context，主语应是 unknown
  assert.equal(
    c.some((cl) => cl.subject === 'unknown'),
    true,
    '无上文代词应保持 unknown',
  );
  assert.equal(selfAccepted('他昨天摔过，现在没事').length, 0);
});

test('corpus: 我今天头晕，老伴也说他头晕', () => {
  const c = claimsOf('我今天头晕，老伴也说他头晕');
  assert.equal(c[0]?.subject, 'self');
  assert.equal(c[0]?.tags[0], 'dizziness');
  // 第二条 "老伴" 是 spouse
  const spouse = c.find((cl) => cl.subject === 'spouse');
  assert.ok(spouse, '老伴应是 spouse');
  assert.equal(spouse?.tags[0], 'dizziness');
  assert.equal(selfAccepted('我今天头晕，老伴也说他头晕').length, 1, '本人头晕进入本人事实流');
});

test('corpus: 昨晚睡不好，今天好多了', () => {
  const c = claimsOf('昨晚睡不好，今天好多了');
  assert.equal(c[0]?.timeScope, 'lastNight');
  assert.equal(c[0]?.eventDate, '2026-09-09');
  assert.equal(c[0]?.tags[0], 'poorSleep');
});

test('corpus: 前几天我喘，今天没什么了', () => {
  const c = claimsOf('前几天我喘，今天没什么了');
  // "前几天" 是 historical, eventDate 应当 null
  const hist = c.find((cl) => cl.timeScope === 'historical');
  assert.ok(hist, '前几天应判为 historical');
  assert.equal(hist?.eventDate, null, 'historical 不应伪造 eventDate');
  assert.equal(selfAccepted('前几天我喘，今天没什么了').length, 0, 'historical 事实不进入本人今天流');
});

test('corpus: 我以前摔过，不是这次', () => {
  const c = claimsOf('我以前摔过，不是这次');
  assert.equal(c[0]?.timeScope, 'historical');
  assert.equal(c[0]?.eventDate, null);
  assert.equal(selfAccepted('我以前摔过，不是这次').length, 0);
});

test('corpus: 刚才说错了，不是我，是我爸', () => {
  const chat: { id: string; role: 'elder'; text: string; time: string }[] = [
    { id: 'e1', role: 'elder', text: '我头晕', time: '09-10 09:00' },
  ];
  const u = understandElderInput('刚才说错了，不是我，是我爸', TODAY, chat);
  assert.equal(u.correction, true);
  assert.equal(u.correctionTargetMessageId, 'e1');
  // 新声明的 subject 是 father
  assert.equal(u.claims[0]?.subject, 'father');
});

test('corpus: 不是胸痛，我只是有点喘', () => {
  const c = claimsOf('不是胸痛，我只是有点喘');
  // 拆分两条
  assert.equal(
    c.some((cl) => cl.status === 'negated'),
    true,
    '否定应被识别为 negated',
  );
  assert.equal(selfAccepted('不是胸痛，我只是有点喘').length, 1, '喘是 occurred，应进入本人事实流');
});

test('corpus: 我没胸痛，不过刚才差点摔倒', () => {
  const c = claimsOf('我没胸痛，不过刚才差点摔倒');
  // "没胸痛" 是 negated
  assert.equal(
    c.some((cl) => cl.status === 'negated' && cl.tags.includes('chestPain')),
    true,
    '胸痛否定',
  );
  // "差点摔倒" 是 near_miss
  assert.equal(
    c.some((cl) => cl.status === 'near_miss' && cl.tags.includes('fall')),
    true,
    '差点摔倒应为 near_miss',
  );
  assert.equal(selfAccepted('我没胸痛，不过刚才差点摔倒').length, 0, '两者都不应进入本人事实流');
});

test('corpus: 血压150/90，我爸的是180/110', () => {
  const c = claimsOf('血压150/90，我爸的是180/110');
  assert.equal(c[0]?.subject, 'self');
  assert.equal(c[0]?.hasHealthValue, true);
  // 第二个 "我爸的" 是 father
  const father = c.find((cl) => cl.subject === 'father');
  assert.ok(father, '应识别父亲血压');
  assert.equal(father?.hasHealthValue, true);
  // 数值抽取应能拿 4 个 mmHg
  const values = extractBloodPressureValues('血压150/90，我爸的是180/110');
  assert.equal(values.length, 4, '应抽出 4 个血压值');
  // 父亲数值 180/110
  assert.ok(values.some((v) => v.metric === 'systolic' && v.value === 180));
  assert.ok(values.some((v) => v.metric === 'diastolic' && v.value === 110));
});
