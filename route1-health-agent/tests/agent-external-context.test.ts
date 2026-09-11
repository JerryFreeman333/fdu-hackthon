import { buildAgentContext } from '../src/engine/context';
import { sanitizeExternalContext } from '../src/engine/agent';
import { isPublicHealthEvent, measurementToEvent, observationToEvent, type HealthEvent } from '../src/pipeline/events';
import type { ElderProfile } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TODAY = '2026-09-11';

const profile: ElderProfile = {
  name: '测试奶奶',
  age: 72,
  conditions: [],
  medications: [],
  familyContact: '',
  familyPhone: '',
  mobility: 'uses_cane',
  usesCane: true,
  nightVision: 'normal',
  cognition: 'stable',
  familySharing: 'granted',
};

function stepsEvent(date: string, value: number, visibility: 'family_ok' | 'private'): HealthEvent {
  return measurementToEvent({
    id: `steps-${date}-${value}`,
    timestamp: `${date}T12:00:00`,
    metric: 'steps',
    value,
    unit: '步',
    source: 'demo',
    confidence: 1,
    visibility,
  });
}

function buildEvents(): HealthEvent[] {
  const events: HealthEvent[] = [];
  // 基线窗口（外部 twin：today-17..today-4）稳定 5000 步。
  for (let i = 17; i >= 4; i -= 1) {
    const date = new Date(Date.parse(TODAY) - i * 86400000).toISOString().slice(0, 10);
    events.push(stepsEvent(date, 5000, 'family_ok'));
  }
  // 最近 3 天公开读数掉到 3000 步：公开趋势应为 declining。
  for (const offset of [2, 1]) {
    const date = new Date(Date.parse(TODAY) - offset * 86400000).toISOString().slice(0, 10);
    events.push(stepsEvent(date, 3000, 'family_ok'));
  }
  // 私密步数读数不得影响对外趋势。
  events.push(stepsEvent(TODAY, 200, 'private'));
  // 公开/私密观察各一条。
  events.push(
    observationToEvent({
      id: 'obs-public',
      date: TODAY,
      source: 'chat',
      text: '我这两天有点头晕',
      tags: ['dizziness'],
      visibility: 'family_ok',
    }),
  );
  events.push(
    observationToEvent({
      id: 'obs-private',
      date: TODAY,
      source: 'chat',
      text: '这件事不要记录给孩子看',
      tags: ['pain'],
      visibility: 'private',
    }),
  );
  return events;
}

function main() {
  // 隐私过滤原语：private 事件必须被识别。
  const events = buildEvents();
  assert(events.filter(isPublicHealthEvent).length === events.length - 2, 'two private events must be filtered');

  const context = buildAgentContext(profile, events, TODAY, []);
  const external = sanitizeExternalContext(context);

  // P2-2 回归：公开趋势必须驱动外部 Person Twin（此前整体被置 unknown，外部 LLM 无从追问）。
  assert(
    external.personTwin.activity === 'declining',
    `public activity decline must survive, got ${external.personTwin.activity}`,
  );
  assert(
    !external.observations.some((observation) => observation.visibility === 'private'),
    'private observations must never leave the device',
  );
  assert(
    external.personTwin.recentSymptoms.includes('dizziness') && !external.personTwin.recentSymptoms.includes('pain'),
    'public symptoms in, private symptoms out',
  );
  assert(
    external.personTwin.safetyRelevantChanges.some((change) => change.includes('活动量下降')),
    'public activity decline must surface as a safety-relevant change',
  );
  // 功能画像来自老人自述档案（非测量数据），保留以支撑外部 LLM 的表达。
  assert(external.personTwin.functionalProfile.usesCane === true, 'self-reported functional profile must survive');
  // 指标仍按既有逐条 visibility 边界过滤。
  assert(
    external.metrics.every((metric) => metric.visibility !== 'private'),
    'private metrics must stay filtered',
  );

  console.log('PASS: external agent context keeps public person twin while filtering private data');
}

main();
