/**
 * 演示数据：王秀兰奶奶 · 72岁 · 高血压 + 心功能减退风险
 * 故事线：前 16 天平稳（构成个人基线），最近 5 天出现"活动耐量下降"信号
 * （步数骤降、步速变慢、夜醒增多、静息心率升高、体重快速上升、血氧略降），
 * 同时老人在聊天里说出"累/喘/睡不好/脚肿"。
 *
 * 注意：全部为模拟数据，仅用于演示。
 */
import type { ChatMessage, DayRecord, ElderProfile, Observation } from '../types';

export const TODAY = '2026-09-06';

export const profile: ElderProfile = {
  name: '王秀兰奶奶',
  age: 72,
  conditions: ['高血压（已控制）', '心功能减退（随访中）'],
  medications: ['氨氯地平 5mg 每日一次', '美托洛尔 23.75mg 每日一次'],
  familyContact: '女儿 李芳 138****6677',
};

/** 生成 21 天的确定性数据（最后 5 天恶化） */
function buildRecords(): DayRecord[] {
  const records: DayRecord[] = [];
  const start = Date.parse('2026-08-17');
  for (let i = 0; i < 21; i++) {
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    const declining = i >= 16;
    const k = declining ? i - 16 : 0; // 0..4 恶化进度

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

/** 聊天里已经识别出的主诉（演示开始前） */
export const seedObservations: Observation[] = [
  { id: 'obs-1', date: '2026-09-03', source: 'chat', text: '今天很累，什么都不想干', tags: ['fatigue'] },
  { id: 'obs-2', date: '2026-09-04', source: 'chat', text: '最近走路有点喘，走两步就想歇', tags: ['dyspnea'] },
  { id: 'obs-3', date: '2026-09-05', source: 'chat', text: '这两天睡不好，一晚上要起来好几趟', tags: ['poorSleep'] },
  {
    id: 'obs-4',
    date: '2026-09-06',
    source: 'chat',
    text: '早上脚踝有点肿，鞋都紧了',
    tags: ['edema'],
  },
];

/** 拍照录入的历史（模拟 OCR 结果） */
export const seedPhotoObservations: Observation[] = [
  { id: 'photo-1', date: '2026-09-01', source: 'photo', text: '拍照录入：血压 138/84 mmHg', tags: [] },
  { id: 'photo-2', date: '2026-09-04', source: 'photo', text: '拍照录入：体重 63.4 kg', tags: [] },
  { id: 'photo-3', date: '2026-09-06', source: 'photo', text: '拍照录入：血压 148/88 mmHg', tags: ['bpHigh'] },
];

/** 已经发生的聊天（演示开始前） */
export const seedChat: ChatMessage[] = [
  { id: 'c1', role: 'elder', text: '今天很累，什么都不想干', time: '09-03 09:12' },
  {
    id: 'c2',
    role: 'agent',
    text: '累的时候先歇着，别硬撑。这种累是一直都有，还是活动以后才明显？',
    time: '09-03 09:12',
  },
  { id: 'c3', role: 'elder', text: '最近走路有点喘，走两步就想歇', time: '09-04 08:40' },
  {
    id: 'c4',
    role: 'agent',
    text: '好，我记下了。喘的时候有没有胸口发闷？休息一会儿能缓过来吗？',
    time: '09-04 08:40',
  },
  { id: 'c5', role: 'elder', text: '这两天睡不好，一晚上要起来好几趟', time: '09-05 07:55' },
  {
    id: 'c6',
    role: 'agent',
    text: '我记下了。起夜多的话，地上留个夜灯，慢慢走，当心摔倒。',
    time: '09-05 07:55',
  },
  { id: 'c7', role: 'elder', text: '早上脚踝有点肿，鞋都紧了', time: '09-06 08:05' },
  {
    id: 'c8',
    role: 'agent',
    text: '脚肿这个事咱们要认真对待。今天先少盐清淡一点，把脚垫高休息。我已经把这些变化整理给您的女儿了。',
    time: '09-06 08:05',
  },
];
