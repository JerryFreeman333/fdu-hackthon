import type { AgentContext } from './context';
import type { SymptomTag } from '../types';

export interface FollowUpQuestion {
  id: string;
  reason: string;
  question: string;
  relatedTags: SymptomTag[];
}

/**
 * 只在上下文提供了“为什么要问”的情况下追问。
 * 规则故意保持小而可审计，避免第一阶段退化成每日问卷。
 */
export function suggestFollowUpQuestions(tags: SymptomTag[], context: AgentContext): FollowUpQuestion[] {
  const questions: FollowUpQuestion[] = [];
  const hasTag = (tag: SymptomTag) => tags.includes(tag);

  if ((hasTag('fatigue') || hasTag('dyspnea')) && context.personTwin.activity === 'declining') {
    questions.push({
      id: 'activity-change-onset',
      reason: '最近活动量已经低于个人平时，同时老人主动提到疲劳/气喘。',
      question: '这种变化大概是最近几天才开始的吗？',
      relatedTags: ['fatigue', 'dyspnea'],
    });
  }

  if (
    (hasTag('poorSleep') || context.personTwin.recentSymptoms.includes('poorSleep')) &&
    context.personTwin.nightActivity === 'declining'
  ) {
    questions.push({
      id: 'night-wake-frequency',
      reason: '最近夜间活动已经增加，又出现睡眠相关主诉。',
      question: '大概一晚上会起来几次？',
      relatedTags: ['poorSleep'],
    });
  }

  if (hasTag('dizziness')) {
    questions.push({
      id: 'dizziness-position',
      reason: '头晕与起身稳定性有关，直接关系到居家活动安全。',
      question: '是刚站起来时更晕，还是坐着也会晕？有没有差点摔倒？',
      relatedTags: ['dizziness', 'fall'],
    });
  }

  if (hasTag('fall')) {
    questions.push({
      id: 'fall-injury-check',
      reason: '跌倒后需要先确认是否受伤以及是否能安全移动。',
      question: '现在能自己坐稳吗？有没有明显疼痛、出血，或者站不起来？',
      relatedTags: ['fall'],
    });
  }

  return questions.slice(0, 2);
}
