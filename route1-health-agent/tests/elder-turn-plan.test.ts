/**
 * planElderTurn 纯规划层（评审 P1-5）回归：
 * 1. 回复分块——主气泡/小字回执/独立隐私行各就各位，replyText 与旧版单气泡拼接一致；
 * 2. no_record 时事件一个不落，隐私行独立成块；
 * 3. 注入的 today 决定事件归属日期（配合时钟服务，跨午夜不把新消息算到昨天）；
 * 4. 家属消息不进本人健康档案，但生成家属事实与回执；
 * 5. 用药遗漏在完整记录路径触发 medicationMissed。
 */
import { planElderTurn, type ElderTurnPlan, type ElderTurnRequest } from '../src/engine/elderTurn';
import { ruleBasedAdapter } from '../src/engine/agent';
import { understandElderInput } from '../src/engine/understanding';
import type { Finding } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function buildRequest(overrides: Partial<ElderTurnRequest> & { text: string }): Promise<ElderTurnPlan> {
  const { text, ...rest } = overrides;
  return planElderTurn({
    text,
    understanding: understandElderInput(text, rest.today ?? '2026-09-12', []),
    priorChat: [],
    findings: [] as Finding[],
    events: [],
    familySharing: 'denied',
    agentContext: undefined,
    llmAdapter: ruleBasedAdapter,
    today: '2026-09-12',
    now: '09-12 08:30',
    receivedAt: '2026-09-12T08:30:00.000',
    sourceMessageId: 'elder-test-1',
    idSeed: 1757600000000,
    ...rest,
  });
}

async function main() {
  // 场景一：摔倒（安全标签）——主气泡是安全指导，记录回执降为小字，隐私行独立成行。
  const fallPlan = await buildRequest({ text: '我今天早上在厕所摔了一跤' });
  assert(fallPlan.replyBlocks[0]?.kind === 'main', '回复第一块必须是主气泡');
  assert(
    fallPlan.replyBlocks[0]?.text.includes('先别急着起身'),
    `摔倒的主气泡应是安全指导，实际：${fallPlan.replyBlocks[0]?.text}`,
  );
  const fallReceipt = fallPlan.replyBlocks.find((block) => block.kind === 'receipt');
  assert(fallReceipt?.text.includes('我已经记下') === true, '记录回执应作为小字回执出现');
  const fallPrivacy = fallPlan.replyBlocks[fallPlan.replyBlocks.length - 1];
  assert(fallPrivacy.kind === 'privacy' && fallPrivacy.text.includes('只供您本人使用'), '隐私声明必须独立成行');
  assert(fallPlan.replyText.includes('先别急着起身'), 'replyText 保留主气泡内容');
  assert(fallPlan.replyText.includes('我已经记下'), 'replyText 保留记录回执（兼容旧版拼接）');
  assert(fallPlan.safetyAction === true, '摔倒必须带紧急联系行动条');
  assert(fallPlan.eventsToAppend.length >= 1, '摔倒事件必须入库');
  assert(
    fallPlan.eventsToAppend.every((event) => event.timestamp.startsWith('2026-09-12')),
    '未显式说日期的摔倒事件必须归到注入的 today',
  );
  assert(fallPlan.medicationMissed === false, '摔倒回合不触发用药任务');

  // 场景二：注入的 today 决定归属日期——跨午夜后（today=09-13）新消息归新的一天。
  const afterMidnightPlan = await buildRequest({ text: '我今天早上在厕所摔了一跤', today: '2026-09-13' });
  assert(
    afterMidnightPlan.eventsToAppend.every((event) => event.timestamp.startsWith('2026-09-13')),
    '注入 today=09-13 时事件必须归到 09-13（评审 P1-4 配套）',
  );

  // 场景三：no_record——事件一个不落，隐私行独立成块，toast 是隐私声明。
  const noRecordPlan = await buildRequest({ text: '我头晕，这段不要记录' });
  assert(noRecordPlan.recordIntent === 'no_record', '明确要求不记录时必须是 no_record');
  assert(noRecordPlan.eventsToAppend.length === 0, 'no_record 不得产生任何健康事件');
  assert(noRecordPlan.correction === null, 'no_record 不做更正处理');
  const noRecordPrivacy = noRecordPlan.replyBlocks[noRecordPlan.replyBlocks.length - 1];
  assert(
    noRecordPrivacy.kind === 'privacy' && noRecordPrivacy.text.includes('不会保存到健康记录'),
    'no_record 的隐私边界必须独立成行显示在回复里',
  );
  assert(noRecordPlan.toast.includes('不会保存到健康记录'), 'toast 必须如实告知不记录');
  assert(!noRecordPlan.replyText.includes('不会保存到健康记录'), 'replyText 保持旧版行为（隐私声明只走 toast）');

  // 场景四：家属消息——不进本人档案，但生成家属事实与回执主气泡。
  const familyPlan = await buildRequest({ text: '我爸今天血压150/95' });
  assert(familyPlan.eventsToAppend.length === 0, '家属消息不得写进本人健康事件');
  assert(familyPlan.familyEventsToAppend.length === 1, '家属消息必须生成家属事实');
  assert(familyPlan.familyEventsToAppend[0]?.subject === 'father', '家属事实应归属父亲');
  assert(
    familyPlan.replyBlocks[0]?.text.includes('不会记到您本人的健康档案'),
    `家属消息的主气泡应说明隐私边界，实际：${familyPlan.replyBlocks[0]?.text}`,
  );

  // 场景五：用药遗漏——完整记录路径触发 medicationMissed。
  const medPlan = await buildRequest({ text: '我今天早上忘了吃降压药' });
  assert(medPlan.medicationMissed === true, '用药遗漏必须触发 medicationMissed');
  assert(medPlan.eventsToAppend.length >= 1, '用药遗漏事件必须入库');

  // 场景六：普通血压记录——主气泡是记录回执，replyText 与旧版拼接一致。
  const bpPlan = await buildRequest({ text: '我今天量了血压150/95' });
  assert(bpPlan.replyBlocks[0]?.kind === 'main', '回复第一块必须是主气泡');
  assert(bpPlan.replyBlocks[0]?.text.includes('我已经记下'), '无安全指导时记录回执就是主气泡');
  assert(bpPlan.replyText.includes('我已经记下'), 'replyText 保留记录回执');
  const bpPrivacy = bpPlan.replyBlocks[bpPlan.replyBlocks.length - 1];
  assert(bpPrivacy.kind === 'privacy', '普通记录的共享状态也必须独立成行');

  console.log('PASS: planElderTurn produces chunked replies and record/no-record plans');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
