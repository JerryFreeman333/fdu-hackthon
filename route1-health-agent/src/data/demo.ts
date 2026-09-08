/**
 * 演示数据：王秀兰奶奶 · 72岁
 * 故事线：前 16 天相对平稳，最近 5 天出现活动能力与夜间状态变化。
 * 所有数据均为模拟数据，仅用于产品 Demo。
 */
import type { ChatMessage, DayRecord, ElderProfile, Observation } from '../types';
import { localDate } from '../engine/date';

function localToday(): string {
  return localDate();
}

export const TODAY = localToday();

function dateOffset(offset: number): string {
  return new Date(Date.parse(TODAY) + offset * 86400000).toISOString().slice(0, 10);
}

function chatTime(offset: number, time: string): string {
  return `${dateOffset(offset).slice(5)} ${time}`;
}

export const profile: ElderProfile = {
  name: '王秀兰奶奶',
  age: 72,
  conditions: ['高血压（已控制）', '心功能减退（随访中）'],
  medications: ['氨氯地平 5mg 每日一次', '美托洛尔 23.75mg 每日一次'],
  familyContact: '女儿 李芳 138****6677',
  mobility: 'uses_cane',
  usesCane: true,
  nightVision: 'reduced',
  cognition: 'stable',
  familySharing: 'granted',
};

function buildRecords(): DayRecord[] {
  const records: DayRecord[] = [];
  const start = Date.parse(TODAY) - 20 * 86400000;
  for (let i = 0; i < 21; i += 1) {
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    const declining = i >= 16;
    const k = declining ? i - 16 : 0;
    const steps = declining ? 5200 - k * 720 + ((i * 37) % 140) : 5200 + ((i * 53) % 900) - 450;
    const walkSpeed = declining ? 0.88 - k * 0.05 : 0.88 + ((i * 7) % 5) * 0.01 - 0.02;
    const sleepHours = declining ? 6.4 - k * 0.25 : 6.5 + ((i * 11) % 4) * 0.1 - 0.15;
    const nightWakes = declining ? 1 + Math.min(k, 3) : i % 5 === 0 ? 2 : 1;
    const restingHr = declining ? 72 + k * 3 : 72 + ((i * 13) % 5) - 2;
    const weight = declining ? +(62.3 + k * 0.45).toFixed(1) : +(62.3 + ((i * 3) % 4) * 0.1 - 0.15).toFixed(1);
    const spo2 = declining ? 96 - Math.floor(k / 2) : 96;
    const systolic = declining ? 136 + k * 3 : 134 + ((i * 17) % 6) - 3;
    const diastolic = declining ? 84 + k : 82 + ((i * 5) % 4) - 1;
    records.push({
      date,
      metrics: {
        steps: Math.max(1200, Math.round(steps)),
        walkSpeed: +walkSpeed.toFixed(2),
        sleepHours: +sleepHours.toFixed(1),
        nightWakes,
        restingHr: Math.round(restingHr),
        weight,
        spo2,
        systolic: Math.round(systolic),
        diastolic: Math.round(diastolic),
      },
    });
  }
  return records;
}

export const records: DayRecord[] = buildRecords();

const shareable = { visibility: 'family_ok' as const };
export const seedObservations: Observation[] = [
  {
    id: 'obs-1',
    date: dateOffset(-3),
    source: 'chat',
    text: '今天很累，什么都不想干',
    tags: ['fatigue'],
    ...shareable,
  },
  {
    id: 'obs-2',
    date: dateOffset(-2),
    source: 'chat',
    text: '最近走路有点喘，走两步就想歇',
    tags: ['dyspnea'],
    ...shareable,
  },
  {
    id: 'obs-3',
    date: dateOffset(-1),
    source: 'chat',
    text: '这两天睡不好，一晚上要起来好几趟',
    tags: ['poorSleep'],
    ...shareable,
  },
  { id: 'obs-4', date: dateOffset(0), source: 'chat', text: '早上脚踝有点肿，鞋都紧了', tags: ['edema'], ...shareable },
];

export const seedPhotoObservations: Observation[] = [
  {
    id: 'photo-1',
    date: dateOffset(-5),
    source: 'photo',
    text: '拍照录入：血压 138/84 mmHg',
    tags: [],
    visibility: 'family_ok',
  },
  {
    id: 'photo-2',
    date: dateOffset(-2),
    source: 'photo',
    text: '拍照录入：体重 63.4 kg',
    tags: [],
    visibility: 'family_ok',
  },
  {
    id: 'photo-3',
    date: dateOffset(0),
    source: 'photo',
    text: '拍照录入：血压 148/88 mmHg',
    tags: ['bpHigh'],
    visibility: 'family_ok',
  },
];

export const seedChat: ChatMessage[] = [
  { id: 'c1', role: 'elder', text: '今天很累，什么都不想干', time: chatTime(-3, '09:12'), persisted: true },
  {
    id: 'c2',
    role: 'agent',
    text: '最近活动量也比平时少一些了。我想多了解一点：这种累大概是最近几天才开始的吗？',
    time: chatTime(-3, '09:12'),
    persisted: true,
  },
  { id: 'c3', role: 'elder', text: '最近走路有点喘，走两步就想歇', time: chatTime(-2, '08:40'), persisted: true },
  {
    id: 'c4',
    role: 'agent',
    text: '好，我记下了。是走一点路就喘，还是上楼、快走时更明显？休息后能不能缓过来？',
    time: chatTime(-2, '08:40'),
    persisted: true,
  },
  { id: 'c5', role: 'elder', text: '这两天睡不好，一晚上要起来好几趟', time: chatTime(-1, '07:55'), persisted: true },
  {
    id: 'c6',
    role: 'agent',
    text: '我记下了。因为最近夜间活动也增加了，我想确认一下：大概一晚上会起来几次？',
    time: chatTime(-1, '07:55'),
    persisted: true,
  },
  { id: 'c7', role: 'elder', text: '早上脚踝有点肿，鞋都紧了', time: chatTime(0, '08:05'), persisted: true },
  {
    id: 'c8',
    role: 'agent',
    text: '我先帮您记下来。最近有几项变化叠在一起，我建议今天和女儿联系一下；如果呼吸明显困难或突然不舒服加重，要及时求助。',
    time: chatTime(0, '08:05'),
    persisted: true,
  },
];
