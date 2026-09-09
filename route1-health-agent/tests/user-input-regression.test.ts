import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';
import { collectFamilyNotifications } from '../src/engine/escalate';
import type { Finding } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TODAY = '2026-09-08';

function runCase(name: string, fn: () => void) {
  fn();
  console.log(`PASS: ${name}`);
}

runCase('口语化“我觉得他……”不会归到本人，也不会在身份不明时直接进入家属账本', () => {
  const input = understandElderInput('我觉得他喘得厉害', TODAY);
  assert(input.claims.length === 1, '应识别出一条关于第三人称的健康事实');
  assert(input.claims[0].subject === 'unknown', '未说明“他”是谁时应保持 unknown');
  assert(Boolean(input.clarificationQuestion), '身份不明时应先澄清');
  assert(acceptedSelfClaims(input).length === 0, '他人的喘不能进入本人健康事件流');
});

runCase('口语化“我看他……”不会丢掉跌倒事实，也不会误记成老人本人', () => {
  const input = understandElderInput('我看他今天走路不太稳，摔了一下', TODAY);
  assert(input.claims.length === 2, '逗号后的跌倒事实也应独立提取');
  assert(input.claims[0].subject === 'unknown', '第一条未指明身份时应保持 unknown');
  assert(input.claims[1].subject === 'unknown', '第二条无主语时应延续未确认主体');
  assert(input.claims[1].tags.includes('fall'), '第二条应保留跌倒标签');
  assert(Boolean(input.clarificationQuestion), '第三人称身份不明时应要求澄清');
  assert(acceptedSelfClaims(input).length === 0, '家属跌倒不能进入老人本人档案');
});

runCase('“今天没有像昨天那样喘得厉害了”保留为今天的持续症状', () => {
  const input = understandElderInput('今天没有像昨天那样喘得厉害了', TODAY);
  assert(input.claims.length === 1, '比较式症状应形成一条 claim');
  const claim = input.claims[0];
  assert(claim.status === 'occurred', '比较/缓解表达不应被当成完全否定');
  assert(claim.timeScope === 'today', '事件主体是今天的状态');
  assert(claim.eventDate === TODAY, '事件日期应绑定到今天而非比较基准昨天');
  assert(claim.tags.includes('dyspnea'), '应继续保留喘的症状标签');
  assert(acceptedSelfClaims(input).length === 1, '改善中的症状仍应进入本人健康事件流');
});

runCase('“我爸……，我也……”拆成两条独立事实', () => {
  const input = understandElderInput('我爸今天没吃降压药，我也没吃', TODAY);
  assert(input.claims.length === 2, '同一句中的两个主体应形成两条 claim');
  assert(input.claims[0].subject === 'father', '第一条应属于父亲');
  assert(input.claims[0].tags.includes('medicationMissed'), '第一条应识别漏服药物');
  assert(input.claims[0].status === 'occurred', '“没吃药”应作为已发生的漏服事件处理');
  assert(input.claims[1].subject === 'self', '第二条“我也没吃”应属于本人');
  assert(input.claims[1].tags.includes('medicationMissed'), '第二条也应识别漏服药物');
  assert(input.claims[1].status === 'occurred', '本人的“没吃药”同样应作为已发生的漏服事件');
  assert(acceptedSelfClaims(input).length === 1, '本人漏服药物事实不能被前面的“我爸”吞掉');
});

runCase('撤销共享后历史一次性 finding 不再触发家属通知', () => {
  const finding: Finding = {
    id: 'finding-1',
    date: TODAY,
    severity: 'urgent',
    title: '跌倒',
    detail: '需要确认安全',
    evidence: ['跌倒'],
    familyMessage: '请联系老人确认是否安全。',
    familyEligible: true,
  };
  assert(collectFamilyNotifications([finding], 'granted').length === 1, '授权时应可见');
  assert(collectFamilyNotifications([finding], 'denied').length === 0, '撤销授权后不应继续通知');
  assert(
    collectFamilyNotifications([finding], 'denied', ['finding-1']).length === 1,
    '显式一次性分享仍可在当前授权周期内生效',
  );
});
