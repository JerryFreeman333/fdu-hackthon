/** 对话 Agent：理解老人表达、解释已经发现的变化，并提出有理由的最少追问。 */
import type { ChatMessage, Finding, SymptomTag } from '../types';
import type { AgentContext } from './context';
import { SYMPTOM_LABELS } from '../types';
import { suggestFollowUpQuestions } from './questions';

interface IntentRule { tag: SymptomTag; patterns: RegExp[]; replies: string[]; }
const INTENT_RULES: IntentRule[] = [
  { tag: 'fatigue', patterns: [/很?累/, /乏/, /没(有)?劲/, /提不起(精神|劲)/, /体力(不|跟不)上/], replies: ['先歇一歇，别硬撑。我也看到最近活动量比平时少一些了。'] },
  { tag: 'dyspnea', patterns: [/喘/, /气(短|不够|促)/, /憋气/, /胸闷/, /上(楼|台阶)(费劲|吃力|喘)/], replies: ['别着急，慢慢说。您提到走路会喘，我会把这个和最近的活动变化放在一起看。'] },
  { tag: 'poorSleep', patterns: [/睡不(好|着|踏实)/, /失眠/, /夜醒/, /起夜/, /半夜(醒|起来)/], replies: ['睡不好确实难受，我记下了。因为最近夜间活动也有变化，我想再确认一个情况。'] },
  { tag: 'edema', patterns: [/(脚|腿|脚踝|小腿).{0,4}肿/, /肿了/, /鞋(紧|挤脚)/, /袜子(印|勒)/], replies: ['我记下了。脚踝或腿部的肿胀如果持续或越来越明显，建议尽快和医生沟通。'] },
  { tag: 'dizziness', patterns: [/头晕/, /头昏/, /站不稳/, /眼前发黑/, /天旋地转/], replies: ['先坐稳，别硬站着。我想确认一下，这样更容易判断当下行动是否安全。'] },
  { tag: 'medicationMissed', patterns: [/(忘|没|漏)(了)?(吃|服|用).{0,3}药/, /药忘/, /忘了.{0,3}药/], replies: ['先别自行加量补吃，按原来的医生方案处理。需要的话，我可以帮您记一件“确认今天是否按原方案服用”的事情。'] },
  { tag: 'bpHigh', patterns: [/血压(有)?(高|偏高)/, /高压\d{3}/], replies: ['先坐下来安静一会儿，再按设备说明复测。单次读数不要自己下结论。'] },
  { tag: 'chestPain', patterns: [/胸(口)?痛/, /胸疼/, /胸口.{0,4}(压迫|压着|紧)/, /心口痛/], replies: ['先停止活动并保持安全姿势。如果胸痛明显或持续，尤其伴喘、冷汗、头晕，应立即寻求急救。'] },
  { tag: 'neuroChange', patterns: [/说话(不清楚|含糊|不利索)/, /(嘴角|嘴).{0,3}(歪|偏)/, /(一侧|半边|一边).{0,4}(无力|没劲|发麻|麻木)/, /(手脚|胳膊|腿).{0,4}(突然)?(无力|没劲|发麻|麻木)/, /突然看不清/], replies: ['先别走动，立即联系家里人并寻求急救。这类突然出现的情况不适合在家继续观察。'] },
  { tag: 'pain', patterns: [/(疼|痛)/, /不舒服/], replies: ['哪里不舒服可以慢慢告诉我：位置、持续多久，以及什么时候最明显。'] },
  { tag: 'moodLow', patterns: [/(心|心情)(烦|闷|不好)/, /没意思/, /孤独/, /想(孩子|家里人)/], replies: ['我在这儿，您慢慢说。'] },
  { tag: 'fall', patterns: [/(摔|跌)(倒|了一跤|了一下)/, /摔倒/], replies: ['先别急着起身，先确认有没有明显疼痛、出血、意识异常或站不起来。'] },
];

export interface ParsedInput { tags: SymptomTag[]; matchedTexts: string[] }
export function parseElderInput(text: string): ParsedInput {
  const tags: SymptomTag[] = [], matchedTexts: string[] = [];
  for (const rule of INTENT_RULES) {
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (match) { tags.push(rule.tag); matchedTexts.push(match[0]); break; }
    }
  }
  return { tags: tags.filter((tag, index) => tags.indexOf(tag) === index), matchedTexts };
}

export function generateAgentReply(
  elderText: string,
  newTags: SymptomTag[],
  findings: Finding[],
  isNewFall: boolean,
  context?: AgentContext,
): string {
  const urgent = context?.priorityFindings.find((finding) => finding.severity === 'urgent');
  if (urgent && newTags.some((tag) => ['chestPain', 'neuroChange', 'fall'].includes(tag))) {
    return `先别做别的：${urgent.title}。${urgent.detail}`;
  }
  if (newTags.length === 0) {
    const changes = context?.personTwin.safetyRelevantChanges ?? [];
    return changes.length
      ? `我在听。我最近也留意到${changes.slice(0, 3).join('、')}。您有什么不舒服，直接告诉我就好。`
      : '我在听。身体有什么不舒服，或者最近走路、睡觉有变化，都可以直接告诉我。';
  }

  const parts: string[] = [];
  for (const tag of newTags.slice(0, 2)) {
    const rule = INTENT_RULES.find((item) => item.tag === tag);
    if (rule) parts.push(rule.replies[0]);
  }

  if (context) {
    const followUps = suggestFollowUpQuestions(newTags, context);
    if (followUps.length > 0) parts.push(followUps[0].question);
  }

  const fusion = context?.priorityFindings.find((f) => f.ruleId === 'fusion.multisignal_deterioration') ?? findings.find((f) => f.ruleId === 'fusion.multisignal_deterioration');
  if (fusion && (newTags.includes('fatigue') || newTags.includes('dyspnea'))) {
    parts.push(`另外我留意了一下：${fusion.evidence[0]}。我会继续帮您观察变化。`);
  }
  if (isNewFall) parts.push('我已经把跌倒标成紧急事件了，请先保持电话畅通。');
  void elderText;
  return parts.join('\n');
}

export const QUICK_INPUTS = ['最近腿有点没劲', '最近走路有点喘', '这两天睡不好', '我有点头晕', '药忘记吃了', '刚才摔了一跤'];
export function msg(role: ChatMessage['role'], text: string, time: string, persisted = true): ChatMessage { return { id: `${role}-${time}-${Math.random().toString(36).slice(2, 8)}`, role, text, time, persisted }; }
export interface LlmAdapter { complete(systemPrompt: string, userText: string, context?: AgentContext): Promise<{ text: string; tags: SymptomTag[] }>; }
export const ruleBasedAdapter: LlmAdapter = { async complete(_systemPrompt, userText) { const parsed = parseElderInput(userText); return { text: '', tags: parsed.tags }; } };
export function tagLabel(tag: SymptomTag): string { return SYMPTOM_LABELS[tag]; }
