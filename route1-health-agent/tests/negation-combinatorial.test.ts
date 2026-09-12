import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedSelfClaims, hasDeathReport, understandElderInput, statusFromText } from '../src/engine/understanding';
import { parseElderInput } from '../src/engine/agent';
import { runDetection } from '../src/engine/detect';
import { measurementToEvent, observationToEvent, type HealthEvent } from '../src/pipeline/events';
import type { HealthMeasurement, Observation, SymptomTag } from '../src/types';

const TODAY = '2026-09-11';

/**
 * 组合式否定语义测试（审查反馈：不要一句一句手挑回归用例）。
 *
 * 否定/程度表达在中文里是开放集合，本文件用「否定标记 × 症状表达」笛卡尔积
 * 生成用例，断言结构化否定检测的语义性质：
 *   1. 否定辖域内的症状 → status=negated，且不进入本人健康事件流；
 *   2. 含否定字但语义为阳性的固定说法（没睡好/喘不上气/不小心摔了/没劲）→ 仍记为发生；
 *   3. 痊愈/消失后缀（头晕好了/肿消了）→ negated；
 *   4. 否定语义端到端不触发 safety.* 紧急规则（假警报是上一轮审查的核心危害）。
 */

const NEGATION_MARKERS = [
  '不太',
  '不',
  '没',
  '没有',
  '未曾',
  '毫不',
  '毫无',
  '一点不',
  '一点都不',
  '一点儿也不',
  '丝毫不',
  '根本不',
  '根本没',
  '压根不',
  '半点不',
  '从来没',
  '从未',
  '并没有',
  '不再',
] as const;

// 症状表达 → 期望打上的标签（取自 agent.ts INTENT_RULES 的真实关键词）
const SYMPTOM_EXPRESSIONS: Array<[string, SymptomTag[]]> = [
  ['喘', ['dyspnea']],
  ['胸闷', ['dyspnea']],
  ['头晕', ['dizziness']],
  ['头疼', ['pain']],
  ['脚肿', ['edema']],
  ['胸口疼', ['chestPain', 'pain']],
  ['累', ['fatigue']],
  ['摔倒', ['fall']],
];

function claimsOf(text: string) {
  return understandElderInput(text, TODAY).claims;
}

function acceptedCount(text: string): number {
  return acceptedSelfClaims(understandElderInput(text, TODAY)).length;
}

test('否定标记 × 症状表达：全部判为 negated 且不进入健康档案', () => {
  const failures: string[] = [];
  for (const marker of NEGATION_MARKERS) {
    for (const [symptom] of SYMPTOM_EXPRESSIONS) {
      const text = `我今天${marker}${symptom}`;
      const claims = claimsOf(text);
      const symptomClaims = claims.filter((claim) => claim.tags.length > 0);
      if (symptomClaims.length === 0) {
        failures.push(`${text}: 未产生任何带标签的 claim`);
        continue;
      }
      for (const claim of symptomClaims) {
        if (claim.status !== 'negated') failures.push(`${text}: status=${claim.status}，应为 negated`);
      }
      if (acceptedCount(text) !== 0) failures.push(`${text}: 竟然被记入健康档案`);
    }
  }
  assert.equal(failures.length, 0, `组合矩阵存在反例：\n${failures.join('\n')}`);
});

test('含否定字但语义为阳性的固定说法必须仍然记录（防矫枉过正）', () => {
  const positives: Array<[string, SymptomTag]> = [
    ['我不舒服', 'pain'],
    ['今天一直不舒服', 'pain'],
    ['昨晚没睡好', 'poorSleep'],
    ['最近睡不好', 'poorSleep'],
    ['老是睡不着', 'poorSleep'],
    ['喘不上气', 'dyspnea'],
    ['爬楼喘不过气', 'dyspnea'],
    ['不小心摔了一跤', 'fall'],
    ['腿没劲', 'fatigue'],
    ['今天没劲', 'fatigue'],
    ['我忍不住疼', 'pain'],
    ['药忘记吃了', 'medicationMissed'],
    ['今天忘记吃药了', 'medicationMissed'],
  ];
  const failures: string[] = [];
  for (const [text, expectedTag] of positives) {
    const accepted = acceptedSelfClaims(understandElderInput(text, TODAY));
    const hasTag = accepted.some((claim) => claim.tags.includes(expectedTag));
    if (!hasTag) failures.push(`${text}: 期望记录 ${expectedTag}，实际 accepted=${JSON.stringify(accepted)}`);
  }
  assert.equal(failures.length, 0, `正面习语被误杀：\n${failures.join('\n')}`);
});

test('痊愈/消失后缀等价于否定（"头晕没了"不得误触去世守卫）', () => {
  const recoveries = [
    '头晕好了',
    '头晕好了很多',
    '疼消失了',
    '脚肿消了',
    '胸闷缓解了',
    '喘停了',
    '头晕没了',
    '腿肿减轻了',
  ];
  const failures: string[] = [];
  for (const text of recoveries) {
    const input = understandElderInput(text, TODAY);
    const claims = input.claims.filter((claim) => claim.tags.length > 0);
    if (!claims.every((claim) => claim.status === 'negated')) {
      failures.push(`${text}: ${JSON.stringify(claims.map((c) => c.status))}，应为 negated`);
    }
    if (acceptedCount(text) !== 0) failures.push(`${text}: 竟然被记入健康档案`);
    if (hasDeathReport(input)) failures.push(`${text}: 痊愈表达误触去世守卫`);
  }
  assert.equal(failures.length, 0, `痊愈表达矩阵存在反例：\n${failures.join('\n')}`);
});

test('去世守卫不受痊愈判定影响（"老伴没了"仍是 death guard）', () => {
  const input = understandElderInput('我老伴没了', TODAY);
  assert.ok(hasDeathReport(input), '家人离世的"没了"必须保留 death guard');
});

test('混合辖域：没喘但头疼 → 不记假警报也不静默丢弃，转入追问确认', () => {
  // 部分否定 + 部分发生：整句记 occurred 会制造假警报，整句记 negated 会丢真实症状。
  // 保守解是 uncertain → 不入档，回复层追问确认。
  const input = understandElderInput('没喘但头疼', TODAY);
  const tagged = input.claims.filter((claim) => claim.tags.length > 0);
  assert.ok(tagged.length > 0, '混合辖域应保留症状语义供追问');
  assert.ok(tagged.every((claim) => claim.status === 'uncertain' || claim.status === 'negated'));
  assert.equal(acceptedCount('没喘但头疼'), 0, '混合辖域不允许任何症状直接入档');
});

test('带转折的否定辖域不越过转折词', () => {
  // "不头晕，但头疼" 拆成两个子句后各自独立判断
  const claims = claimsOf('不头晕，但头疼');
  const dizziness = claims.find((claim) => claim.tags.includes('dizziness'));
  const pain = claims.find((claim) => claim.tags.includes('pain'));
  assert.equal(dizziness?.status, 'negated');
  assert.equal(pain?.status, 'occurred');
});

test('statusFromText 的不确定性/假设/擦边信号不被结构化否定覆盖', () => {
  const uncertain = statusFromText('可能不太喘', ['dyspnea'], false);
  assert.equal(uncertain, 'uncertain');
  const hypothetical = statusFromText('如果头晕了怎么办', ['dizziness'], false);
  assert.equal(hypothetical, 'hypothetical');
  const nearMiss = statusFromText('差点摔倒', ['fall'], false);
  assert.equal(nearMiss, 'near_miss');
});

test('端到端：否定语义不得触发紧急安全规则（今天不太喘了 + 血压 185）', () => {
  // 上一轮审查的核心危害链：好转陈述 → dyspnea occurred → safety.blood_pressure.severe_reading
  // 判 urgent → 推送"血压高且伴危险症状"的紧急家属通知。修复后这条链必须断开。
  const text = '今天不太喘了';
  const accepted = acceptedSelfClaims(understandElderInput(text, TODAY));
  assert.equal(accepted.length, 0, '否定句不应产生任何本人健康事件');

  // 对照组：同样的血压，但症状真实发生 → 必须 urgent
  const withRealSymptom: HealthEvent[] = [
    measurementToEvent({
      id: 'm-bp',
      timestamp: `${TODAY}T12:00:00`,
      metric: 'systolic',
      value: 185,
      unit: 'mmHg',
      source: 'demo',
      confidence: 1,
      visibility: 'family_ok',
    }),
    measurementToEvent({
      id: 'm-bp2',
      timestamp: `${TODAY}T12:00:00`,
      metric: 'diastolic',
      value: 95,
      unit: 'mmHg',
      source: 'demo',
      confidence: 1,
      visibility: 'family_ok',
    }),
    observationToEvent({
      id: 'obs-dyspnea',
      date: TODAY,
      source: 'chat',
      text: '我有点喘',
      tags: ['dyspnea'],
      status: 'occurred',
      visibility: 'family_ok',
    } as Observation),
  ];
  const urgentFindings = runDetection(withRealSymptom, TODAY).filter((finding) => finding.severity === 'urgent');
  assert.ok(urgentFindings.length > 0, '对照组：真实症状 + 高血压应触发 urgent');

  // 反例组：只有"好转"观察（若被错误记录为 occurred）也不得与高血压合成 urgent
  const negatedObservation: Observation = {
    id: 'obs-negated',
    date: TODAY,
    source: 'chat',
    text,
    tags: ['dyspnea'],
    status: 'negated',
    visibility: 'family_ok',
  };
  const controlFindings = runDetection(
    [...withRealSymptom.slice(0, 2), observationToEvent(negatedObservation)],
    TODAY,
  ).filter((finding) => finding.severity === 'urgent');
  assert.equal(controlFindings.length, 0, 'status=negated 的喘不得参与紧急判定');
});

test('数值对照：老人没提数值时 extractHealthValues 不受否定影响而误取数字', () => {
  assert.deepEqual(parseElderInput('今天不太喘了').tags, ['dyspnea']);
  assert.equal(parseElderInput('今天不太喘了').matchedTexts[0], '喘');
});
