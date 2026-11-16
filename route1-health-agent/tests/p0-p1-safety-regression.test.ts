import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage, HealthMeasurement, HistoricalHealthEvent, Observation } from '../src/types';
import type { FamilyHealthEvent } from '../src/types';
import {
  activeFamilySafetyEvents,
  buildFamilySafetyItem,
  familyEventDate,
  gatedFamilySafetyEvents,
  isFamilySafetyEvent,
  sanitizeFamilyEventsPayload,
  visibleFamilySafetyEvents,
} from '../src/engine/familyLedger';
import { familySafetyFinding, isFamilySafetyFinding } from '../src/engine/familySafetyNotify';
import { planElderTurn } from '../src/engine/elderTurn';
import {
  appendHistoricalHealthEvents,
  removeCorrectedHistoricalHealthEvents,
  splitHistoricalHealthEvents,
} from '../src/engine/historyLedger';
import type { FamilyNotificationRecord } from '../src/engine/notify';
import { dispatchFamilyNotifications, pendingRetryChannels } from '../src/engine/notify';
import { selectFamilyPriority } from '../src/engine/familyPriority';
import { acceptedSelfClaims, historicalSelfClaims, understandElderInput } from '../src/engine/understanding';
import { generateAgentReply, parseElderInput, ruleBasedAdapter } from '../src/engine/agent';
import { extractHealthValues } from '../src/engine/extract';
import { runDetection } from '../src/engine/detect';
import { collectFamilyNotifications, type FamilyNotification } from '../src/engine/escalate';
import { buildUnacceptedClaimsReply } from '../src/engine/userFacing';
import { measurementToEvent, observationToEvent, type HealthEvent } from '../src/pipeline/events';
import type { HomeSafetyAction } from '../src/adapters/HomeSafetyActionAdapter';

const TODAY = '2026-11-15';

function elder(id: string, text: string): ChatMessage {
  return { id, role: 'elder', text, time: `${TODAY}T10:00:00.000Z` };
}

function obs(text: string, tags: Observation['tags'], status: Observation['status'] = 'occurred'): HealthEvent {
  return observationToEvent({
    id: `obs-${text}`,
    date: TODAY,
    source: 'chat',
    text,
    tags,
    status,
    visibility: 'family_ok',
  });
}

function measurement(
  metric: HealthMeasurement['metric'],
  value: number,
  visibility: HealthMeasurement['visibility'] = 'family_ok',
): HealthEvent {
  return measurementToEvent({
    id: `m-${metric}-${value}`,
    timestamp: `${TODAY}T12:00:00`,
    metric,
    value,
    unit: metric === 'bloodGlucose' ? 'mmol/L' : metric === 'temperature' ? '℃' : 'mmHg',
    source: 'chat',
    confidence: 0.9,
    visibility,
    metadata: { sourceText: `${metric}=${value}`, eventDate: TODAY },
  });
}

function familyEvent(overrides: Partial<FamilyHealthEvent> = {}): FamilyHealthEvent {
  return {
    id: `family-${overrides.tags?.join('-') ?? 'event'}`,
    timestamp: `${TODAY}T10:00:00`,
    source: 'chat',
    subject: 'father',
    text: '我爸说他胸口痛',
    tags: ['chestPain'],
    hasHealthValue: false,
    status: 'occurred',
    visibility: 'family_ok',
    shareMode: 'persistent',
    ...overrides,
  };
}

function planTurn(text: string, priorChat: ChatMessage[] = [], familySharing: 'granted' | 'denied' = 'denied') {
  return planElderTurn({
    text,
    understanding: understandElderInput(text, TODAY, priorChat),
    priorChat,
    findings: [],
    events: [],
    familySharing,
    agentContext: undefined,
    llmAdapter: ruleBasedAdapter,
    today: TODAY,
    now: '11-15 10:00',
    receivedAt: `${TODAY}T10:00:00.000`,
    sourceMessageId: 'elder-history-1',
    idSeed: 1757900000000,
  });
}

function historicalEvent(overrides: Partial<HistoricalHealthEvent> = {}): HistoricalHealthEvent {
  return {
    id: 'history-1',
    eventDate: '2026-11-13',
    recordedAt: `${TODAY}T10:00:00.000`,
    source: 'chat',
    text: '我前天胸闷',
    tags: ['dyspnea'],
    hasHealthValue: false,
    status: 'occurred',
    visibility: 'family_ok',
    sourceMessageId: 'elder-history-1',
    ...overrides,
  };
}

test('P0: 晕厥被识别为急救级事件，而不是静默丢弃', () => {
  const parsed = parseElderInput('我刚才晕倒了');
  assert.ok(parsed.tags.includes('syncope'));

  const input = understandElderInput('我刚才晕倒了', TODAY);
  const accepted = acceptedSelfClaims(input);
  assert.equal(accepted.length, 1);
  assert.ok(accepted[0]?.tags.includes('syncope'));

  const findings = runDetection([obs('我刚才晕倒了', ['syncope'])], TODAY);
  const syncope = findings.find((finding) => finding.ruleId === 'safety.syncope');
  assert.ok(syncope);
  assert.equal(syncope?.severity, 'urgent');
  assert.match(syncope?.familyMessage ?? '', /晕厥|意识丧失/);
});

test('P0: “差点晕倒”是 near_miss，不产生急救告警', () => {
  const input = understandElderInput('我刚才差点晕倒了', TODAY);
  assert.deepEqual(acceptedSelfClaims(input), []);
  assert.equal(input.claims.find((claim) => claim.tags.includes('syncope'))?.status, 'near_miss');
  assert.equal(
    runDetection([], TODAY).some((finding) => finding.ruleId === 'safety.syncope'),
    false,
  );
});

test('P0: 泛化问句和历史晕厥不得被当成今天刚发生的急救事件', () => {
  const advice = understandElderInput('晕倒了怎么办', TODAY);
  assert.deepEqual(acceptedSelfClaims(advice), []);
  assert.equal(advice.claims.find((claim) => claim.tags.includes('syncope'))?.status, 'uncertain');

  for (const text of ['我晕倒过', '我有晕倒史', '我以前晕倒过']) {
    const input = understandElderInput(text, TODAY);
    assert.equal(input.claims[0]?.timeScope, 'historical', `${text}: 应归为历史`);
    assert.deepEqual(acceptedSelfClaims(input), [], `${text}: 不得进入今天的急救事件流`);
  }
});

test('P0: 95/60 且站起来发黑不得标成血压偏高，并按低血压方向提醒', () => {
  const parsed = parseElderInput('我血压95/60，站起来发黑');
  assert.equal(parsed.tags.includes('bpHigh'), false, '95/60 不是高血压');
  assert.ok(parsed.tags.includes('dizziness'), '站起来发黑必须进入头晕/体位性症状');

  const findings = runDetection(
    [measurement('systolic', 95), measurement('diastolic', 60), obs('站起来发黑', ['dizziness'])],
    TODAY,
  );
  const low = findings.find((finding) => finding.ruleId === 'safety.blood_pressure.low');
  assert.ok(low, '临界低值伴症状必须产生可解释的发现');
  assert.equal(low?.severity, 'alert');
  assert.match(low?.evidence.join(' ') ?? '', /95\/60/);
  assert.equal(
    findings.some((finding) => finding.ruleId === 'safety.blood_pressure.severe_reading'),
    false,
  );
});

test('P0: 真实的 150/95 仍然标为血压偏高', () => {
  assert.ok(parseElderInput('血压150/95').tags.includes('bpHigh'));
  assert.ok(parseElderInput('高压150').tags.includes('bpHigh'));
});

test('P0: “上周摔了一跤”归为历史，不再当成当天跌倒告警', () => {
  const input = understandElderInput('上周摔了一跤', TODAY);
  assert.equal(input.claims[0]?.timeScope, 'historical');
  assert.equal(input.claims[0]?.eventDate, null);
  assert.deepEqual(acceptedSelfClaims(input), []);
  assert.equal(
    runDetection([], TODAY).some((finding) => finding.ruleId === 'safety.fall'),
    false,
  );
  const reply = buildUnacceptedClaimsReply(input.claims);
  assert.match(reply, /过去的情况/);
  assert.doesNotMatch(reply, /已经发生了，还是只是想问问/);
});

test('P0: “走两步就喘”不得写成 steps=2 污染活动基线', () => {
  const values = extractHealthValues('我最近走两步就喘');
  assert.equal(
    values.some((value) => value.metric === 'steps'),
    false,
  );
  assert.ok(parseElderInput('我最近走两步就喘').tags.includes('dyspnea'));
});

test('P1: “昨晚只睡三小时”能抽出睡眠时长', () => {
  const values = extractHealthValues('昨晚只睡三小时');
  assert.ok(values.some((value) => value.metric === 'sleepHours' && value.value === 3));
});

test('P1: 血糖 126 mg/dL 换算为 7.0 mmol/L，不触发高血糖急救告警', () => {
  const values = extractHealthValues('血糖126');
  const glucose = values.find((value) => value.metric === 'bloodGlucose');
  assert.equal(glucose?.value, 7);
  assert.equal(glucose?.unit, 'mmol/L');
  assert.ok(parseElderInput('血糖126').tags.includes('glucoseHigh'), '7.0 仍作为偏高提示复测');

  const findings = runDetection([measurement('bloodGlucose', 7)], TODAY);
  assert.equal(
    findings.some((finding) => finding.ruleId === 'safety.blood_glucose.extreme'),
    false,
  );
});

test('P1-B: 体温支持摄氏/华氏明确写法，裸数字不猜测', () => {
  const celsius = extractHealthValues('我发烧38度5').find((value) => value.metric === 'temperature');
  assert.equal(celsius?.value, 38.5);
  assert.equal(celsius?.unit, '℃');

  const decimal = extractHealthValues('体温39.2℃').find((value) => value.metric === 'temperature');
  assert.equal(decimal?.value, 39.2);

  const chinese = extractHealthValues('体温三十八度五').find((value) => value.metric === 'temperature');
  assert.equal(chinese?.value, 38.5);

  const fahrenheit = extractHealthValues('烧到101华氏度').find((value) => value.metric === 'temperature');
  assert.equal(fahrenheit?.value, 38.3);

  const fahrenheitSymbol = extractHealthValues('101°F').find((value) => value.metric === 'temperature');
  assert.equal(fahrenheitSymbol?.value, 38.3);

  // 裸数字、天气式“今天38度”、其他指标读数都不得写成体温。
  assert.equal(
    extractHealthValues('38.5').some((value) => value.metric === 'temperature'),
    false,
  );
  assert.equal(
    extractHealthValues('今天38度').some((value) => value.metric === 'temperature'),
    false,
  );
  assert.equal(
    extractHealthValues('血糖7.2').some((value) => value.metric === 'temperature'),
    false,
  );
  assert.equal(
    extractHealthValues('体温50度').some((value) => value.metric === 'temperature'),
    false,
  );
});

test('P1-B: 体温读数按产品安全阈值分级，watch 不通知家属', () => {
  const watch = runDetection([measurement('temperature', 38.5)], TODAY).find(
    (finding) => finding.ruleId === 'safety.temperature.fever',
  );
  assert.equal(watch?.severity, 'watch');
  assert.equal(watch?.familyMessage, undefined, '38.0–38.9 ℃ 只记录观察，不推家属通知');
  assert.match(watch?.detail ?? '', /这不是诊断|不能自行下诊断/);

  const alert = runDetection([measurement('temperature', 39.2)], TODAY).find(
    (finding) => finding.ruleId === 'safety.temperature.fever',
  );
  assert.equal(alert?.severity, 'alert');
  assert.ok(alert?.familyMessage, '39.0–39.9 ℃ 需要生成家属消息');
  assert.match(alert?.familyMessage ?? '', /体温/);

  const urgent = runDetection([measurement('temperature', 40.2)], TODAY).find(
    (finding) => finding.ruleId === 'safety.temperature.fever',
  );
  assert.equal(urgent?.severity, 'urgent');
  assert.match(urgent?.familyMessage ?? '', /【紧急】/);
});

test('P1-B: 发热伴晕厥/胸痛/喘/神经变化升级为 urgent', () => {
  for (const [tag, text] of [
    ['syncope', '我刚才晕倒了'],
    ['chestPain', '我胸口痛'],
    ['dyspnea', '我喘不上气'],
    ['neuroChange', '我说话不清楚'],
  ] as const) {
    const findings = runDetection([measurement('temperature', 38.5), obs(text, [tag])], TODAY);
    const temperature = findings.find((finding) => finding.ruleId === 'safety.temperature.fever');
    assert.equal(temperature?.severity, 'urgent', `${tag}: 发热伴危险症状必须升级`);
    assert.ok(temperature?.familyMessage);
  }
});

test('P1-B: 私密体温读数不进入家属内容', () => {
  const findings = runDetection([measurement('temperature', 39.5, 'private')], TODAY);
  const temperature = findings.find((finding) => finding.ruleId === 'safety.temperature.fever');
  assert.equal(temperature?.severity, 'alert');
  assert.equal(temperature?.familyMessage, undefined);
  assert.equal(temperature?.familyEligible, false);
  assert.doesNotMatch(temperature?.evidence.join(' ') ?? '', /39\.5/);
});

test('P1-B: 体温读数能被识别为发热标签并进入值感知回复', async () => {
  assert.ok(parseElderInput('我体温39度').tags.includes('fever'));
  assert.ok(parseElderInput('我低烧37.8').tags.includes('fever'));
  assert.equal(parseElderInput('我体温36.8').tags.includes('fever'), false, '正常体温不凭关键词制造发热标签');

  const reply = await generateAgentReply('我体温39度', ['fever'], [], false);
  assert.match(reply, /39\.0\s*℃/, '回复必须引用实际读数，而不是只说“发烧了”');
  assert.match(reply, /联系医生|复测/, '回复必须给出下一步');
  assert.match(reply, /这不是诊断/, '回复不得把产品分流阈值说成诊断');
});

test('P1-C: 家人安全通道带主体标签，且不进入老人本人检测', () => {
  for (const [tag, text, expected] of [
    ['syncope', '我爸刚才晕倒了', '晕厥/意识丧失'],
    ['chestPain', '我爸说他胸口痛', '胸痛'],
    ['neuroChange', '我爸说话不清楚', '突发神经系统异常'],
    ['fall', '我爸摔了一跤', '跌倒'],
    ['melena', '我爸大便发黑', '黑便/便血'],
  ] as const) {
    const event = familyEvent({ id: `family-${tag}`, tags: [tag], text });
    const visible = visibleFamilySafetyEvents([event], 'granted');
    assert.equal(visible.length, 1, `${tag}: 已授权家人安全事件必须可见`);
    const item = buildFamilySafetyItem(visible[0]!);
    assert.equal(item.subjectLabel, '父亲');
    assert.match(item.title, /父亲/);
    assert.match(item.title, new RegExp(expected));
    assert.match(item.message, /这不是诊断/);
  }

  // 家人事实只在独立台账中使用；老人本人检测没有收到任何事件。
  assert.deepEqual(runDetection([], TODAY), []);
});

test('P1-C: 未授权/私密家人安全事件只暴露数量，不暴露内容', () => {
  const event = familyEvent({ id: 'family-private-syncope', tags: ['syncope'], visibility: 'private' });

  assert.deepEqual(visibleFamilySafetyEvents([event], 'granted'), []);
  assert.equal(gatedFamilySafetyEvents([event], 'granted').length, 1);

  const sharedEvent = familyEvent({ id: 'family-denied-fall', tags: ['fall'] });
  assert.deepEqual(visibleFamilySafetyEvents([sharedEvent], 'denied'), []);
  assert.equal(gatedFamilySafetyEvents([sharedEvent], 'denied').length, 1);

  // 一次性共享必须持有该事件 id 才可见；未持有时同样只计数。
  assert.deepEqual(visibleFamilySafetyEvents([{ ...sharedEvent, shareMode: 'one_time' }], 'granted'), []);
  assert.equal(
    visibleFamilySafetyEvents([{ ...sharedEvent, shareMode: 'one_time' }], 'granted', [sharedEvent.id]).length,
    1,
  );
});

test('P1-C: 非 occurred / 非安全标签不进入家人安全通道', () => {
  for (const status of ['negated', 'hypothetical', 'uncertain', 'near_miss'] as const) {
    const event = familyEvent({ id: `family-${status}`, tags: ['syncope'], status });
    assert.deepEqual(visibleFamilySafetyEvents([event], 'granted'), [], `${status}: 不得进入安全通道`);
    assert.equal(gatedFamilySafetyEvents([event], 'granted').length, 0, `${status}: 也不应计入被挡住的安全事件`);
  }

  const nonSafety = familyEvent({ id: 'family-fever', tags: ['fever'], text: '我爸发烧了' });
  assert.deepEqual(visibleFamilySafetyEvents([nonSafety], 'granted'), []);
  assert.equal(gatedFamilySafetyEvents([nonSafety], 'granted').length, 0);
});

test('P2-A: 有明确日期的既往事实进入独立账本，不写进今天的事件流', async () => {
  const input = understandElderInput('我前天胸闷', TODAY);
  const history = historicalSelfClaims(input);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.eventDate, '2026-11-13');
  // 理解层的日期语义保持不变（时间回归依赖它），分流发生在回合规划层。
  assert.equal(acceptedSelfClaims(input).length, 1);

  const plan = await planTurn('我前天胸闷');
  assert.deepEqual(plan.eventsToAppend, [], '既往事实不得写成今天的 Observation/Measurement');
  assert.equal(plan.historyEventsToAppend.length, 1);
  assert.equal(plan.historyEventsToAppend[0]?.eventDate, '2026-11-13');
  assert.equal(plan.historyEventsToAppend[0]?.status, 'occurred');
  assert.match(plan.replyText, /既往情况/);
  assert.match(plan.replyText, /不用于今天的安全判断/);
  assert.match(plan.replyText, /2026-11-13/);
});

test('P2-A: 日期不详的既往情况保留 null，不拿录入当天冒充', async () => {
  const plan = await planTurn('我以前摔过');
  assert.deepEqual(plan.eventsToAppend, []);
  assert.equal(plan.historyEventsToAppend.length, 1);
  assert.equal(plan.historyEventsToAppend[0]?.eventDate, null);
  assert.ok(plan.historyEventsToAppend[0]?.tags.includes('fall'));
  assert.match(plan.replyText, /日期不详/);
  assert.match(plan.replyText, /不用于今天的安全判断/);
  assert.doesNotMatch(plan.replyText, new RegExp(TODAY), '日期不详时不得用今天冒充发生日期');
});

test('P2-A: 同一条消息里的既往事实与今天事实分开落账', async () => {
  const plan = await planTurn('我前天胸闷，今天又胸闷');
  assert.equal(plan.historyEventsToAppend.length, 1);
  assert.equal(plan.historyEventsToAppend[0]?.eventDate, '2026-11-13');
  assert.ok(plan.eventsToAppend.length >= 1, '今天的胸闷仍要进入今天的事件流');
  assert.ok(
    plan.eventsToAppend.every((event) => event.timestamp.startsWith(TODAY)),
    '今天事实不能被历史日期带偏',
  );
  assert.match(plan.replyText, /既往情况/);
});

test('P2-A: 既往账本按同一句话去重，并支持按日期/日期不详分组', () => {
  const dated = historicalEvent();
  const undated = historicalEvent({
    id: 'history-undated',
    eventDate: null,
    text: '我以前摔过',
    tags: ['fall'],
    recordedAt: `${TODAY}T09:00:00.000`,
  });
  const duplicate = historicalEvent({ id: 'history-dup' });
  const appended = appendHistoricalHealthEvents([], [dated, duplicate, undated]);
  assert.equal(appended.length, 2, '日期+原文+标签相同的既往事实只保留一条');

  const sections = splitHistoricalHealthEvents(appended);
  assert.deepEqual(
    sections.dated.map((event) => event.id),
    ['history-1'],
  );
  assert.deepEqual(
    sections.undated.map((event) => event.id),
    ['history-undated'],
  );
});

test('P2-A: 更正只撤销上一句话命中的既往事实，不误删其它日期或标签', () => {
  const events = [
    historicalEvent({ id: 'h-dyspnea', tags: ['dyspnea'] }),
    historicalEvent({ id: 'h-dizziness', tags: ['dizziness'], text: '我前天头晕' }),
    historicalEvent({ id: 'h-other-message', tags: ['dyspnea'], sourceMessageId: 'elder-history-2' }),
  ];
  const remaining = removeCorrectedHistoricalHealthEvents(events, 'elder-history-1', ['dizziness']);
  assert.deepEqual(
    remaining.map((event) => event.id),
    ['h-dyspnea', 'h-other-message'],
  );

  const wholeMessage = removeCorrectedHistoricalHealthEvents(events, 'elder-history-1');
  assert.deepEqual(
    wholeMessage.map((event) => event.id),
    ['h-other-message'],
  );
});

test('P1: 体重下降、心慌、发热、黑便不再被静默丢弃', () => {
  assert.ok(parseElderInput('我最近瘦了五斤').tags.includes('weightLoss'));
  assert.ok(parseElderInput('我心慌得厉害').tags.includes('palpitations'));
  assert.ok(parseElderInput('我发烧38度5').tags.includes('fever'));
  assert.ok(parseElderInput('我大便发黑').tags.includes('melena'));

  const weightLoss = runDetection([obs('我最近瘦了五斤', ['weightLoss'])], TODAY);
  assert.ok(weightLoss.some((finding) => finding.ruleId === 'weight.short_term_loss'));

  const palpitations = runDetection([obs('我心慌得厉害', ['palpitations'])], TODAY);
  assert.ok(palpitations.some((finding) => finding.ruleId === 'symptom.palpitations.reminder'));

  const melena = runDetection([obs('我大便发黑', ['melena'])], TODAY);
  const melenaFinding = melena.find((finding) => finding.ruleId === 'safety.melena');
  assert.ok(melenaFinding);
  assert.equal(melenaFinding?.severity, 'alert');
  assert.ok(melenaFinding?.familyMessage);
});

test('P1: “没问题就是有点头晕”不能被前半句否定吞掉', () => {
  const input = understandElderInput('没问题就是有点头晕', TODAY);
  const accepted = acceptedSelfClaims(input);
  assert.equal(accepted.length, 1);
  assert.ok(accepted[0]?.tags.includes('dizziness'));
  assert.equal(accepted[0]?.status, 'occurred');
});

test('P0: 跨回合裸省略主语回到老人本人，不沿用老伴', () => {
  const history = [
    elder('m1', '我老伴昨天头晕'),
    { id: 'a1', role: 'agent' as const, text: '好的。', time: `${TODAY}T10:01:00.000Z` },
  ];
  const input = understandElderInput('今天起夜三次', TODAY, history);
  assert.equal(input.claims[0]?.subject, 'self');
  assert.ok(input.claims[0]?.tags.includes('poorSleep'));
  assert.equal(input.claims[0]?.eventDate, TODAY);
});

test('P1: 跨刷新重试覆盖微信推送，且不重发已送达渠道', () => {
  const record: FamilyNotificationRecord = {
    findingId: 'f-1',
    severity: 'urgent',
    title: 't',
    message: 'm',
    reason: 'r',
    createdAt: `${TODAY}T12:00:00.000Z`,
    lifecycle: 'new',
    deliveries: [
      { channel: 'in_app', status: 'sent', detail: '', at: '' },
      { channel: 'browser_push', status: 'sent', detail: '', at: '' },
      { channel: 'webhook_push', status: 'failed', detail: 'network', at: '' },
    ],
  };
  assert.deepEqual(pendingRetryChannels(record), ['webhook_push']);
});

test('P1: 家属首页的 urgent 健康通知优先于居家安全', () => {
  const notification: FamilyNotification = {
    finding: { id: 'f', date: TODAY, severity: 'urgent', title: '晕厥', detail: '', evidence: [] },
    message: '请立即联系老人',
    reason: '安全规则',
    oneTime: false,
  };
  const homeAction: HomeSafetyAction = {
    id: 'h',
    riskId: 'r',
    title: '地面湿滑',
    description: '建议处理',
    action: '擦干',
    requiresRescan: true,
    closureRule: 'rescan',
    status: 'open',
    source: 'route2-person-home-risk',
  };
  assert.equal(selectFamilyPriority({ notification, homeAction }).kind, 'urgent-notification');
  assert.equal(
    selectFamilyPriority({
      notification: { ...notification, finding: { ...notification.finding, severity: 'alert' } },
      homeAction,
    }).kind,
    'home-safety',
  );
});

test('P1: 家属通知门控不会把黑便 alert 吞掉', () => {
  const findings = runDetection([obs('我大便发黑', ['melena'])], TODAY);
  const notifications = collectFamilyNotifications(findings, 'granted', [], TODAY);
  assert.ok(notifications.some((item) => item.finding.ruleId === 'safety.melena'));
});

// ===== P0-1：体温按测量部位分阈值 =====

function temperatureMeasurement(value: number, site: HealthMeasurement['temperatureSite']): HealthEvent {
  return measurementToEvent({
    id: `m-temperature-${site ?? 'none'}-${value}`,
    timestamp: `${TODAY}T12:00:00`,
    metric: 'temperature',
    value,
    unit: '℃',
    source: 'chat',
    confidence: 0.9,
    visibility: 'family_ok',
    temperatureSite: site,
    metadata: { sourceText: `temperature=${value}`, eventDate: TODAY, temperatureSite: site ?? 'unknown' },
  });
}

test('P0-1: 抽取器把部位绑定到具体读数，不在整句里乱套', () => {
  const axillary = extractHealthValues('腋温37.6');
  assert.equal(axillary[0]?.temperatureSite, 'axillary');

  const ear = extractHealthValues('耳温38.4');
  assert.equal(ear[0]?.temperatureSite, 'ear');

  const oral = extractHealthValues('舌下37.9');
  assert.equal(oral[0]?.temperatureSite, 'oral');

  const rectal = extractHealthValues('肛温38.6');
  assert.equal(rectal[0]?.temperatureSite, 'rectal');

  // 两个读数、两个部位：必须各归各的，不能把后一个部位套到前一个读数上。
  const mixed = extractHealthValues('腋温37.6，耳温38.4');
  assert.equal(mixed.length, 2);
  assert.equal(mixed[0]?.temperatureSite, 'axillary');
  assert.equal(mixed[1]?.temperatureSite, 'ear');

  // 原文没说部位时保持 unknown，绝不默认成腋温。
  const unknown = extractHealthValues('体温38.4');
  assert.equal(unknown[0]?.temperatureSite, 'unknown');
});

test('P0-1: 同一个读数不同部位判级不同，且按部位各自聚合', () => {
  // 38.4 ℃：耳温尚未到该部位的"联系医生"档，腋温已经超过。
  const ear = runDetection([temperatureMeasurement(38.4, 'ear')], TODAY).find(
    (finding) => finding.ruleId === 'safety.temperature.fever',
  );
  assert.equal(ear?.severity, 'watch');

  const axillary = runDetection([temperatureMeasurement(38.4, 'axillary')], TODAY).find(
    (finding) => finding.ruleId === 'safety.temperature.fever',
  );
  assert.equal(axillary?.severity, 'alert');
  assert.match(axillary?.evidence.join(' ') ?? '', /腋温/);

  // 腋温 37.5 过去被全局 38.0 阈值漏掉；现在必须进入观察档，而不是当正常。
  const lowGrade = runDetection([temperatureMeasurement(37.5, 'axillary')], TODAY).find(
    (finding) => finding.ruleId === 'safety.temperature.fever',
  );
  assert.equal(lowGrade?.severity, 'watch');
  assert.equal(lowGrade?.familyMessage, undefined, 'watch 仍不通知家属');

  // 多条读数：代表读数取自己部位判级最高的那条，不能拿"未分部位最大值"冒充。
  const mixed = runDetection(
    [temperatureMeasurement(38.6, 'ear'), temperatureMeasurement(38.2, 'axillary')],
    TODAY,
  ).find((finding) => finding.ruleId === 'safety.temperature.fever');
  assert.equal(mixed?.severity, 'alert');
  assert.match(mixed?.evidence.join(' ') ?? '', /腋温/);
});

test('P0-1: 未说明部位按 unknown 档评估，并在文案里要求补记', () => {
  const lowGrade = runDetection([temperatureMeasurement(37.5, 'unknown')], TODAY).find(
    (item) => item.ruleId === 'safety.temperature.fever',
  );
  assert.equal(lowGrade?.severity, 'watch', '未分部位的 37.5 可能是腋温低热，不能静默当正常');
  assert.equal(lowGrade?.familyMessage, undefined, 'watch 仍不通知家属');

  const finding = runDetection([temperatureMeasurement(39.2, 'unknown')], TODAY).find(
    (item) => item.ruleId === 'safety.temperature.fever',
  );
  assert.equal(finding?.severity, 'alert');
  assert.match(finding?.detail ?? '', /没有说明是腋温、口温还是耳温/);
  assert.match(finding?.evidence.join(' ') ?? '', /未分部位/);
});

test('P0-1: 对话回合把部位写进测量元数据，并把双读数都保留下来', async () => {
  const plan = await planTurn('我腋温37.6，耳温38.4', [], 'granted');
  const temperatures = plan.eventsToAppend
    .filter((event) => event.type === 'measurement' && event.measurement.metric === 'temperature')
    .map((event) => (event.type === 'measurement' ? event.measurement : null))
    .filter((item): item is HealthMeasurement => item !== null);
  assert.equal(temperatures.length, 2, '同一句话里的两个体温读数不能被 id 去重吞掉');
  assert.deepEqual(temperatures.map((item) => item.temperatureSite).sort(), ['axillary', 'ear']);
  assert.deepEqual(temperatures.map((item) => item.metadata?.temperatureSite).sort(), ['axillary', 'ear']);
});

// ===== P0-2：家人安全事件接入统一派发 =====

test('P0-2: 家人安全事件转成标准 urgent 发现，五类都不降级', () => {
  for (const [tag, text] of [
    ['syncope', '我爸刚才晕倒了'],
    ['chestPain', '我爸说胸口痛'],
    ['neuroChange', '我爸说话不清楚'],
    ['fall', '我爸摔了一跤'],
    ['melena', '我爸大便发黑'],
  ] as const) {
    const item = buildFamilySafetyItem(familyEvent({ id: `family-${tag}`, tags: [tag], text }));
    const finding = familySafetyFinding(item);
    assert.equal(finding.severity, 'urgent', `${tag}: 必须保持紧急`);
    assert.equal(finding.date, TODAY);
    assert.ok(isFamilySafetyFinding(finding));
    assert.match(finding.id, /^family-safety:/);
    assert.ok(finding.familyMessage);
    assert.match(finding.familyMessage ?? '', /【紧急】/);
  }

  const melena = familySafetyFinding(
    buildFamilySafetyItem(familyEvent({ id: 'family-melena-2', tags: ['melena'], text: '我爸大便发黑' })),
  );
  assert.match(melena.carePath ?? '', /立即联系/);
});

test('P0-2: 家人安全事件在当前窗口内按天可重申，历史事件不冒充今天的急症', () => {
  const recent = familyEvent({ id: 'family-recent', eventDate: TODAY, timeScope: 'today' });
  const yesterday = familyEvent({
    id: 'family-yesterday',
    eventDate: '2026-11-14',
    timeScope: 'yesterday',
  });
  const yesterdayReportedYesterday = familyEvent({
    id: 'family-yesterday-old-report',
    eventDate: '2026-11-14',
    timestamp: '2026-11-14T10:00:00',
    timeScope: 'yesterday',
  });
  const historic = familyEvent({
    id: 'family-historic',
    eventDate: '2026-11-09',
    timeScope: 'historical',
    text: '我爸上周摔了一跤',
  });
  const undated = familyEvent({
    id: 'family-undated',
    eventDate: null,
    timeScope: 'historical',
    text: '我爸以前晕倒过',
  });

  const active = activeFamilySafetyEvents(
    [recent, yesterday, yesterdayReportedYesterday, historic, undated],
    'granted',
    [],
    TODAY,
  );
  assert.deepEqual(
    active.map((event) => event.id),
    ['family-recent', 'family-yesterday', 'family-yesterday-old-report'],
  );

  // 历史事件仍然保留日期，不会用录入当天冒充。
  assert.equal(familyEventDate(historic), '2026-11-09');
  assert.equal(familyEventDate(undated), null);

  // 派发侧认的是"本次提醒日期"：昨天发生、今天才报告的急症今天必须推送；
  // 昨天已报告但家属未确认的事件，由台账在第二天再次重申。
  const notifications = collectFamilyNotifications(
    active.map((event) => familySafetyFinding(buildFamilySafetyItem(event), TODAY)),
    'granted',
    [],
    TODAY,
  );
  assert.deepEqual(
    notifications.map((item) => item.finding.id),
    ['family-safety:family-recent', 'family-safety:family-yesterday', 'family-safety:family-yesterday-old-report'],
  );
  assert.match(notifications[1]?.finding.familyMessage ?? '', /2026-11-14/, '推送仍须写明事件发生日期');
});

test('P0-2: 私密/未授权家人事件不会进入派发队列', () => {
  const safe = familyEvent({ id: 'family-visible', eventDate: TODAY, timeScope: 'today' });
  const privateEvent = familyEvent({
    id: 'family-private',
    eventDate: TODAY,
    timeScope: 'today',
    visibility: 'private',
  });
  const activeDenied = activeFamilySafetyEvents([safe, privateEvent], 'denied', [], TODAY);
  assert.deepEqual(activeDenied, []);

  const activeGranted = activeFamilySafetyEvents([safe, privateEvent], 'granted', [], TODAY);
  assert.deepEqual(
    activeGranted.map((event) => event.id),
    ['family-visible'],
  );

  // 陌生人通过 PeerJS 塞进来的私密事件必须被结构校验挡掉。
  const sanitized = sanitizeFamilyEventsPayload([
    privateEvent,
    { ...safe, id: 'ok', visibility: 'family_ok', shareMode: 'persistent' },
    { nope: true },
  ]);
  assert.deepEqual(
    sanitized.map((event) => event.id),
    ['ok'],
  );
});

test('P0-2: 家人安全事件进入台账、系统通知/微信推送和确认闭环', async () => {
  const finding = familySafetyFinding(
    buildFamilySafetyItem(familyEvent({ id: 'family-syncope', eventDate: TODAY, timeScope: 'today' })),
  );
  const delivered: string[] = [];
  const result = await dispatchFamilyNotifications(
    [finding],
    'granted',
    true,
    [],
    `${TODAY}T10:00:00.000Z`,
    (notification) => {
      delivered.push(notification.finding.id);
      return [
        { channel: 'browser_push', status: 'sent', detail: '已弹出系统通知' },
        { channel: 'webhook_push', status: 'sent', detail: '已推送到微信' },
      ];
    },
  );
  assert.equal(result.dispatchedCount, 1);
  assert.deepEqual(delivered, ['family-safety:family-syncope']);
  const record = result.records[0]!;
  assert.equal(record.severity, 'urgent');
  assert.equal(record.lifecycle, 'new');
  assert.deepEqual(record.deliveries.map((item) => item.channel).sort(), ['browser_push', 'in_app', 'webhook_push']);
});

test('P0-2: 一次性共享的家人安全事件在长期授权为 denied 时仍然必须派发', async () => {
  const finding = familySafetyFinding(
    buildFamilySafetyItem(familyEvent({ id: 'family-once', eventDate: TODAY, timeScope: 'today' })),
  );
  const delivered: string[] = [];
  const result = await dispatchFamilyNotifications(
    [finding],
    'denied',
    true,
    [],
    `${TODAY}T10:00:00.000Z`,
    (notification) => {
      delivered.push(notification.finding.id);
      return [{ channel: 'browser_push', status: 'sent', detail: '已弹出系统通知' }];
    },
    [finding.id],
  );
  assert.equal(result.dispatchedCount, 1);
  assert.deepEqual(delivered, ['family-safety:family-once']);
  assert.equal(result.records[0]?.lifecycle, 'new');
});

test('P0-2: 昨天已报告但家属未确认的家人安全事件，今天必须再次推送', async () => {
  const finding = familySafetyFinding(
    buildFamilySafetyItem(familyEvent({ id: 'family-yesterday', eventDate: '2026-11-14', timeScope: 'yesterday' })),
    TODAY,
  );
  const previous: FamilyNotificationRecord = {
    findingId: finding.id,
    severity: 'urgent',
    title: finding.title,
    message: finding.familyMessage ?? finding.detail,
    actionPath: finding.carePath,
    reason: '出现需要立即确认的安全信号。',
    createdAt: '2026-11-14T10:00:00.000Z',
    deliveries: [{ channel: 'in_app', status: 'sent', detail: '已进入家属端通知中心', at: '2026-11-14T10:00:00.000Z' }],
    lifecycle: 'new',
  };
  const delivered: string[] = [];
  const result = await dispatchFamilyNotifications(
    [finding],
    'granted',
    true,
    [previous],
    `${TODAY}T09:00:00.000Z`,
    (notification) => {
      delivered.push(notification.finding.id);
      return [{ channel: 'browser_push', status: 'sent', detail: '再次弹出系统通知' }];
    },
  );
  assert.equal(result.dispatchedCount, 1);
  assert.deepEqual(delivered, [finding.id]);
  assert.notEqual(result.records[0]?.updatedAt, previous.createdAt);
  assert.equal(result.records[0]?.lifecycle, 'new');

  const acknowledged = await dispatchFamilyNotifications(
    [finding],
    'granted',
    true,
    [{ ...previous, lifecycle: 'acknowledged', acknowledgedAt: '2026-11-14T10:05:00.000Z' }],
    `${TODAY}T09:00:00.000Z`,
    () => [{ channel: 'browser_push', status: 'sent', detail: '不应调用' }],
  );
  assert.equal(acknowledged.dispatchedCount, 0, '已确认的事件不得再次骚扰');

  const sameDay = await dispatchFamilyNotifications(
    [finding],
    'granted',
    true,
    [{ ...previous, createdAt: `${TODAY}T08:00:00.000Z` }],
    `${TODAY}T09:00:00.000Z`,
    () => [{ channel: 'browser_push', status: 'sent', detail: '不应调用' }],
  );
  assert.equal(sameDay.dispatchedCount, 0, '同一天内已推送且未升级时不得重复弹');
});

test('P1: 同一天 alert 升级为 urgent 时台账更新并重新外送，而不是被去重吞掉', async () => {
  const alertFinding = {
    id: 'safety.temperature.fever-2026-11-15',
    date: TODAY,
    severity: 'alert' as const,
    title: '体温明显升高',
    detail: '',
    evidence: [],
    familyMessage: '【请关注】体温 39.2',
    carePath: '联系医生',
    ruleId: 'safety.temperature.fever',
    familyEligible: true,
  };
  const first = await dispatchFamilyNotifications([alertFinding], 'granted', true, [], `${TODAY}T10:00:00.000Z`, () => [
    { channel: 'browser_push', status: 'sent', detail: 'ok' },
  ]);
  assert.equal(first.records[0]?.severity, 'alert');

  const urgentFinding = {
    ...alertFinding,
    severity: 'urgent' as const,
    title: '体温升高并伴危险症状',
    familyMessage: '【紧急】体温 39.2 并伴胸痛',
  };
  const second = await dispatchFamilyNotifications(
    [urgentFinding],
    'granted',
    true,
    first.records,
    `${TODAY}T10:05:00.000Z`,
    () => [{ channel: 'browser_push', status: 'sent', detail: 'ok' }],
  );
  assert.equal(second.dispatchedCount, 1, '升级必须重新派发');
  assert.equal(second.records.length, 1);
  assert.equal(second.records[0]?.severity, 'urgent');
  assert.match(second.records[0]?.message ?? '', /胸痛/);
  assert.equal(second.records[0]?.lifecycle, 'new', '升级后必须重新进入待确认');
  assert.ok(second.records[0]?.updatedAt);

  // 已经是 urgent 后，重复同一条内容不再打扰。
  const third = await dispatchFamilyNotifications(
    [urgentFinding],
    'granted',
    true,
    second.records,
    `${TODAY}T10:06:00.000Z`,
    () => [{ channel: 'browser_push', status: 'sent', detail: 'ok' }],
  );
  assert.equal(third.dispatchedCount, 0);
});

test('P2-A: 日期不详的家人安全事件不再被静默丢弃，也不会当成今天', async () => {
  const plan = await planTurn('我爸以前晕倒过');
  assert.equal(plan.familyEventsToAppend.length, 1);
  const event = plan.familyEventsToAppend[0]!;
  assert.equal(event.eventDate, null);
  assert.equal(event.timeScope, 'historical');
  assert.equal(familyEventDate(event), null);
  assert.equal(isFamilySafetyEvent(event), true);
  assert.equal(
    activeFamilySafetyEvents([event], 'granted', [], TODAY).length,
    0,
    '日期不详的历史事件不能按当前急症推送',
  );
});

test('P0-2: 家人安全优先于居家安全，但老人本人的 urgent 仍排第一', () => {
  const item = buildFamilySafetyItem(familyEvent({ id: 'family-priority', eventDate: TODAY, timeScope: 'today' }));
  const homeAction: HomeSafetyAction = {
    id: 'h',
    riskId: 'r',
    title: '地面湿滑',
    description: '建议处理',
    action: '擦干',
    requiresRescan: true,
    closureRule: 'rescan',
    status: 'open',
    source: 'route2-person-home-risk',
  };
  assert.equal(selectFamilyPriority({ familySafety: item, homeAction }).kind, 'family-safety');

  const urgent: FamilyNotification = {
    finding: { id: 'urgent-self', date: TODAY, severity: 'urgent', title: '老人晕厥', detail: '', evidence: [] },
    message: '请立即联系老人',
    reason: '安全规则',
    oneTime: false,
  };
  assert.equal(
    selectFamilyPriority({ notification: urgent, familySafety: item, homeAction }).kind,
    'urgent-notification',
  );

  const alert: FamilyNotification = {
    ...urgent,
    finding: { ...urgent.finding, id: 'alert-self', severity: 'alert' },
  };
  assert.equal(selectFamilyPriority({ notification: alert, familySafety: item }).kind, 'family-safety');
});
