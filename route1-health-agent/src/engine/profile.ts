import type { ElderProfile } from '../types';

export const PROFILE_KEY = 'ankang-personal-profile-v1';
export const emptyProfile: ElderProfile = {
  name: '',
  age: null,
  conditions: [],
  medications: [],
  familyContact: '',
  mobility: 'unknown',
  usesCane: null,
  nightVision: 'unknown',
  cognition: 'unknown',
  familySharing: 'ask',
  injuryHistory: '',
  usualNightWakes: null,
};

export function validateProfile(value: unknown): ElderProfile {
  if (!value || typeof value !== 'object') throw new Error('档案格式不正确，请重新填写。');
  const p = value as ElderProfile;
  const answers: Record<string, string> = {};
  if (p.profileAnswers != null) {
    if (typeof p.profileAnswers !== 'object' || Array.isArray(p.profileAnswers))
      throw new Error('问答记录格式不正确。');
    for (const key of [
      'name',
      'age',
      'conditions',
      'injuryHistory',
      'mobility',
      'nightVision',
      'usualNightWakes',
      'medications',
    ]) {
      const answer = p.profileAnswers[key];
      if (answer === undefined) continue;
      if (typeof answer !== 'string' || answer.length > 500) throw new Error('回答请控制在 500 字以内。');
      answers[key] = answer;
    }
  }
  if (typeof p.name !== 'string' || p.name.trim().length > 30) throw new Error('称呼请控制在 30 字以内。');
  if (p.age !== null && (!Number.isInteger(p.age) || p.age < 1 || p.age > 120))
    throw new Error('年龄请输入 1～120 的整数，或跳过。');
  if (
    p.usualNightWakes != null &&
    (!Number.isInteger(p.usualNightWakes) || p.usualNightWakes < 0 || p.usualNightWakes > 30)
  )
    throw new Error('起夜次数请输入 0～30 的整数，或跳过。');
  for (const list of [p.conditions, p.medications]) {
    if (!Array.isArray(list) || list.length > 30 || list.some((item) => typeof item !== 'string' || item.length > 100))
      throw new Error('病史或用药信息过长，请简要填写。');
  }
  if (
    !['independent', 'uses_cane', 'needs_support', 'unknown'].includes(p.mobility) ||
    !['normal', 'reduced', 'unknown'].includes(p.nightVision) ||
    !['stable', 'mild_change', 'unknown'].includes(p.cognition) ||
    (p.usesCane !== null && typeof p.usesCane !== 'boolean')
  )
    throw new Error('请选择有效的行动和视力状态。');
  if (p.injuryHistory != null && (typeof p.injuryHistory !== 'string' || p.injuryHistory.length > 500))
    throw new Error('跌倒或骨折经历请控制在 500 字以内。');
  return {
    ...emptyProfile,
    name: p.name.trim(),
    age: p.age,
    conditions: p.conditions.map((s) => s.trim()).filter(Boolean),
    medications: p.medications.map((s) => s.trim()).filter(Boolean),
    mobility: p.mobility,
    usesCane: p.usesCane,
    nightVision: p.nightVision,
    cognition: p.cognition,
    injuryHistory: p.injuryHistory?.trim() ?? '',
    usualNightWakes: p.usualNightWakes ?? null,
    profileSource: 'self',
    profileAnswers: answers,
    profileInterviewComplete: p.profileInterviewComplete === true,
    profileUpdatedAt: typeof p.profileUpdatedAt === 'string' ? p.profileUpdatedAt : undefined,
  };
}
