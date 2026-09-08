import type { ElderProfile } from '../types';
import { validateProfile } from './profile';

export const profileQuestions = [
  { key: 'name', text: '您好，我是阿安。先认识一下您，方便以后照顾您的日常。怎么称呼您？', choices: [] },
  { key: 'age', text: '您今年多大年纪了？比如可以说“我今年七十二岁”。', choices: [] },
  {
    key: 'conditions',
    text: '医生有没有说过您有高血压、糖尿病、冠心病，或其他疾病？没有也可以直接告诉我。',
    choices: ['没有', '有高血压', '有糖尿病'],
  },
  { key: 'injuryHistory', text: '以前有没有摔倒或骨折过？如果有，现在恢复得怎么样了？', choices: ['没有', '不清楚'] },
  {
    key: 'mobility',
    text: '平时走路，您自己能走，还是需要拐杖或别人扶着？',
    choices: ['自己能走', '需要拐杖', '需要别人扶'],
  },
  { key: 'nightVision', text: '晚上开灯以后，您看周围的东西清楚吗？', choices: ['看得清楚', '看不清楚'] },
  { key: 'usualNightWakes', text: '平时一晚上大约起床几次？不起床可以说“零次”。', choices: ['零次', '一次', '两次'] },
  {
    key: 'medications',
    text: '您平时在吃什么药？可以照着药盒说名字。没吃药或记不清名字，也直接告诉我。',
    choices: ['没有吃药', '记不清药名'],
  },
] as const;

export function profileAnswer(profile: ElderProfile, index: number): string {
  const key = profileQuestions[index].key;
  if (key === 'name' && profile.name) return profile.name;
  if (profile.profileAnswers?.[key]) return profile.profileAnswers[key];
  const value = profile[key];
  if (key === 'mobility')
    return { independent: '自己能走', uses_cane: '需要拐杖', needs_support: '需要别人扶', unknown: '' }[
      profile.mobility
    ];
  if (key === 'nightVision') return { normal: '看得清楚', reduced: '看不清楚', unknown: '' }[profile.nightVision];
  return Array.isArray(value) ? value.join('、') : value == null ? '' : String(value);
}

export function nextProfileQuestion(profile: ElderProfile): number {
  const missing = profileQuestions.findIndex((_, index) => !profileAnswer(profile, index));
  return missing < 0 ? profileQuestions.length : missing;
}

function spokenNumber(text: string): number | null {
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const match = text.match(
    /^(?:我(?:今年)?|今年|大约|大概|一晚|晚上)?\s*([0-9]+|[零〇一二两三四五六七八九十百]+)\s*(?:岁|次)?[。！!]?$/,
  );
  if (!match) return null;
  const token = match[1];
  if (/^\d+$/.test(token)) return Number(token);
  // Unlike daily estimates, age must be a single exact number, never an averaged range.
  if (
    !/^(?:[零〇一二两三四五六七八九]|[一二两三四五六七八九]?十[一二三四五六七八九]?|一百(?:零[一二三四五六七八九]|[一二]十[一二三四五六七八九]?)?)$/.test(
      token,
    )
  )
    return null;
  let sum = 0;
  let digit = 0;
  for (const char of token) {
    if (char === '十' || char === '百') {
      sum += (digit || 1) * (char === '十' ? 10 : 100);
      digit = 0;
    } else digit = digits[char];
  }
  return sum + digit;
}

export function answerProfileQuestion(profile: ElderProfile, index: number, input: string): ElderProfile {
  const text = input.trim();
  if (!text || text.length > 500) throw new Error('请简单说一下，回答不要超过 500 字。');
  const key = profileQuestions[index].key;
  const unknown = /^(不清楚|不知道|不想回答|暂不回答|记不清药名)[。！!？?]?$/.test(text);
  const patch: Partial<ElderProfile> = {};
  switch (key) {
    case 'name':
      patch.name = unknown ? '' : text.replace(/^(叫我|我叫|我是)/, '').replace(/[。！!]$/, '');
      break;
    case 'age':
    case 'usualNightWakes': {
      const number = unknown ? null : spokenNumber(text);
      if (!unknown && number === null)
        throw new Error(
          key === 'age'
            ? '我没听准年龄，您可以说“七十二岁”，或直接输入数字。'
            : '我没听准次数，您可以说“两次”，或直接输入数字。',
        );
      patch[key] = number;
      break;
    }
    case 'conditions':
      patch.conditions = [text === '没有' ? '无已知疾病' : text];
      break;
    case 'injuryHistory':
      patch.injuryHistory = text;
      break;
    case 'medications':
      patch.medications = text.split(/[，,、；;\n]/).filter(Boolean);
      break;
    case 'mobility': {
      // ponytail: accept explicit phrases only; ambiguous descriptions need clarification until a language service exists.
      const values: Record<string, ElderProfile['mobility']> = {
        自己能走: 'independent',
        可以独立行走: 'independent',
        不需要拐杖: 'independent',
        需要拐杖: 'uses_cane',
        使用拐杖: 'uses_cane',
        需要别人扶: 'needs_support',
        需要他人协助: 'needs_support',
      };
      const value = unknown ? 'unknown' : values[text.replace(/[。！!]$/, '')];
      if (!value) throw new Error('我再确认一下：您是“自己能走”“需要拐杖”，还是“需要别人扶”？也可以点下面的回答。');
      patch.mobility = value;
      patch.usesCane = value === 'unknown' ? null : value === 'uses_cane';
      break;
    }
    case 'nightVision': {
      const values: Record<string, ElderProfile['nightVision']> = {
        看得清楚: 'normal',
        清楚: 'normal',
        看不清楚: 'reduced',
        不清楚: 'unknown',
        有点模糊: 'reduced',
      };
      const value = unknown ? 'unknown' : values[text.replace(/[。！!]$/, '')];
      if (!value) throw new Error('我再确认一下：开灯后是“看得清楚”还是“看不清楚”？');
      patch.nightVision = value;
    }
  }
  return validateProfile({
    ...profile,
    ...patch,
    profileAnswers: { ...profile.profileAnswers, [key]: text },
    profileUpdatedAt: new Date().toISOString(),
  });
}
