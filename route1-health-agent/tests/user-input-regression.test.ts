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

runCase('口语化“我觉得他……”不会归到本人', () => {
  const input = understandElderInput('我觉得他喘得厉害', TODAY);
  assert(input.claims.length === 1, '应识别出一条关于他人的健康事实');
  assert(input.claims[0].subject === 'unknown', '没有明确家属身份时应保守标为 unknown');
  assert(acceptedSelfClaims(input).length === 0, '他人的喘不能进入本人健康事件流');
  assert(Boolean(input.clarificationQuestion), '身份不明确时必须先澄清');
});

runCase('已有明确家属上下文时第三人称可以延续主体', () => {
  const messages = [
    { id: 'm1', role: 'elder' as const, text: '我爸今天走路不稳', time: '09-08 09:00' },
  ];
  const input = understandElderInput('我觉得他喘得厉害', TODAY, messages);
  assert(input.claims.length === 1, '应识别第三人称事实');
  assert(input.claims[0].subject === 'father', '应继承上一条明确家属主体');
  assert(acceptedSelfClaims(input).length === 0, '家属事实不能进入本人健康事件流');
});

runCase('多个家属同时出现时“他”不能猜成其中任何一个', () => {
  const messages = [
    { id: 'm1', role: 'elder' as const, text: '我爸今天走路不稳', time: '09-08 09:00' },
    { id: 'm2', role: 'elder' as const, text: '我老公今天也不舒服', time: '09-08 09:05' },
  ];
  const input = understandElderInput('我觉得他喘得厉害', TODAY, messages);
  assert(input.claims.length === 1, '应识别第三人称事实');
  assert(input.claims[0].subject === 'unknown', '多个家属上下文时不能武断指定主体');
  assert(acceptedSelfClaims(input).length === 0, '不明确的第三人称事实不能进入本人档案');
  assert(Boolean(input.clarificationQuestion), '多个候选主体时应继续要求澄清');
});

runCase('口语化“我看他……”不会丢掉跌倒事实', () => {
  const input = understandElderInput('我看他今天走路不太稳，摔了一下', TODAY);
  assert(input.claims.length === 2, '逗号后的跌倒事实也应独立提取');
  assert(input.claims[0].subject === 'unknown', '没有明确家属身份时第一条应保持 unknown');
  assert(input.claims[1].subject === 'unknown', '第二条无主语时也应保持 unknown');
  assert(input.claims[1].tags.includes('fall'), '第二条应保留跌倒标签');
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

runCase('一次性分享 id 不能绕过 finding 自身的隐私边界', () => {
  const privateFinding: Finding = {
    id: 'private-finding-1',
    date: TODAY,
    severity: 'urgent',
    title: '跌倒',
    detail: '老人需要确认安全',
    evidence: ['跌倒'],
    familyMessage: '请联系老人确认是否安全。',
    familyEligible: false,
  };
  assert(
    collectFamilyNotifications([privateFinding], 'denied', ['private-finding-1']).length === 0,
    'familyEligible=false 时一次性共享 id 也不能绕过隐私限制',
  );
});
