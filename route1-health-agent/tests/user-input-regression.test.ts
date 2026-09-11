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
  assert(input.claims[0].subject === 'family_other', '“他”应优先于开头的“我”确定主体');
  assert(acceptedSelfClaims(input).length === 0, '他人的喘不能进入本人健康事件流');
});

runCase('口语化“我看他……”不会丢掉跌倒事实', () => {
  const input = understandElderInput('我看他今天走路不太稳，摔了一下', TODAY);
  assert(input.claims.length === 2, '逗号后的跌倒事实也应独立提取');
  assert(input.claims[0].subject === 'family_other', '第一条应属于家属');
  assert(input.claims[1].subject === 'family_other', '第二条无主语时应延续上一条家属主体');
  assert(input.claims[1].tags.includes('fall'), '第二条应保留跌倒标签');
  assert(acceptedSelfClaims(input).length === 0, '家属跌倒不能进入老人本人档案');
});

runCase('二手转述中的家属血压也不能进入本人健康事件流', () => {
  const phrases = ['我看到我爸血压180/110', '我老伴血压180，110', '我觉得他血压180/110'];
  for (const phrase of phrases) {
    const input = understandElderInput(phrase, TODAY);
    assert(
      input.claims.some((claim) => claim.subject !== 'self' && claim.hasHealthValue),
      `${phrase}: 应保留家属血压事实`,
    );
    assert(acceptedSelfClaims(input).length === 0, `${phrase}: 家属血压不能进入本人健康事件流`);
  }
});

runCase('非健康家属语境不会继承上一条健康标签', () => {
  const input = understandElderInput(
    '我今天头晕，昨晚没睡好，早上药忘了吃，我爸摔了一下，女儿也没在家，我现在其实没什么事',
    TODAY,
  );
  const fatherClaims = input.claims.filter((claim) => claim.subject === 'father');
  const contextOnlyFamily = input.claims.filter(
    (claim) => claim.subject === 'family_other' && claim.tags.length === 0 && !claim.hasHealthValue,
  );
  const selfClaims = acceptedSelfClaims(input);
  assert(selfClaims.length === 3, '本人三条健康事实仍应独立保留');
  assert(fatherClaims.length === 1, '父亲跌倒应保留为一条家属健康事实');
  assert(contextOnlyFamily.length === 1, '女儿不在家应保留为家属语境，而不是健康事实');
  assert(!selfClaims.some((claim) => claim.tags.includes('fall')), '父亲跌倒不能污染本人健康事实');
});

runCase('直接的“女儿也没在家”不能继承前一条健康标签', () => {
  const input = understandElderInput('我爸摔了一下，女儿也没在家', TODAY);
  assert(input.claims.length === 2, '父亲跌倒与女儿不在家应拆成两条事实');
  assert(input.claims[0].subject === 'father', '第一条应属于父亲');
  assert(input.claims[0].tags.includes('fall'), '第一条应保留跌倒标签');
  assert(input.claims[1].subject === 'family_other', '第二条应属于家属语境');
  assert(input.claims[1].tags.length === 0, '第二条不得继承跌倒标签');
  assert(!input.claims[1].hasHealthValue, '第二条不得生成健康数值');
  assert(acceptedSelfClaims(input).length === 0, '两条都不能进入本人健康事件流');
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
