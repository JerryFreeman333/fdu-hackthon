/** 对话 Agent：规则负责识别与安全边界，Adapter 负责最终措辞。 */
import type { ChatMessage, Finding, SymptomTag } from '../types';
import type { AgentContext } from './context';
import { SYMPTOM_LABELS } from '../types';
import { suggestFollowUpQuestions } from './questions';

interface IntentRule {
  tag: SymptomTag;
  patterns: RegExp[];
  replies: string[];
}

const INTENT_RULES: IntentRule[] = [
  { tag: 'fatigue', patterns: [/很?累/, /乏/, /没(有)?劲/, /提不起(精神|劲)/, /体力(不|跟不)上/], replies: ['先歇一歇，别硬撑。我也看到最近活动量比平时少一些了。'] },
  { tag: 'dyspnea', patterns: [/喘/, /气(短|不够|促)/, /憋气/, /胸闷/, /上(楼|台阶)(费劲|吃力|喘)/], replies: ['别着急，慢慢说。您提到走路会喘，我会把这个和最近的活动变化放在一起看。'] },
  { tag: 'poorSleep', patterns: [/睡不(好|着|踏实)/, /失眠/, /夜醒/, /起夜/, /半夜(醒|起来)/], replies: ['睡不好确实难受，我记下了。我想再确认一个情况。'] },
  { tag: 'edema', patterns: [/(脚|腿|脚踝|小腿).{0,4}肿/, /肿了/, /鞋(紧|挤脚)/, /袜子(印|勒)/], replies: ['我记下了。脚踝或腿部的肿胀如果持续或越来越明显，建议尽快和医生沟通。'] },
  { tag: 'dizziness', patterns: [/头晕/, /头昏/, /站不稳/, /眼前发黑/, /天旋地转/], replies: ['先坐稳，别硬站着。我想确认一下，这样更容易判断当下行动是否安全。'] },
  { tag: 'medicationMissed', patterns: [/(忘|没|漏)(了)?(吃|服|用).{0,3}药/, /药忘/, /忘了.{0,3}药/], replies: ['先别自行加量补吃，按原来的医生方案处理。'] },
  { tag: 'bpHigh', patterns: [/血压(有)?(高|偏高)/, /高压\d{3}/], replies: ['先坐下来安静一会儿，再按设备说明复测。单次读数不要自己下结论。'] },
  { tag: 'chestPain', patterns: [/胸(口)?痛/, /胸疼/, /胸(口)?.{0,5}(痛|疼)/, /胸口.{0,4}(压迫|压着|紧)/, /心口痛/], replies: ['先停止活动并保持安全姿势。如果胸痛明显或持续，尤其伴喘、冷汗、头晕，应立即寻求急救。'] },
  {
    tag: 'neuroChange',
    patterns: [/说话(不清楚|含糊|不利索)/, /(嘴角|嘴).{0,3}(歪|偏)/, /(一侧|半边|一边).{0,4}(无力|没劲|发麻|麻木)/, /(手脚|胳膊|腿).{0,4}(突然)?(无力|没劲|发麻|麻木)/, /突然看不清/],
    replies: ['先别走动，立即联系家里人并寻求急救。这类突然出现的情况不适合在家继续观察。'],
  },
  { tag: 'pain', patterns: [/(疼|痛)/, /不舒服/], replies: ['哪里不舒服可以慢慢告诉我：位置、持续多久，以及什么时候最明显。'] },
  { tag: 'moodLow', patterns: [/(心|心情)(烦|闷|不好)/, /没意思/, /孤独/, /想(孩子|家里人)/], replies: ['我在这儿，您慢慢说。'] },
  { tag: 'fall', patterns: [/(摔|跌)(倒|了一跤|了一下)/, /摔倒/], replies: ['先别急着起身，先确认有没有明显疼痛、出血、意识异常或站不起来。'] },
];

export interface ParsedInput {
  tags: SymptomTag[];
  matchedTexts: string[];
}

export function parseElderInput(text: string): ParsedInput {
  const tags: SymptomTag[] = [];
  const matchedTexts: string[] = [];
  for (const rule of INTENT_RULES) {
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (match) {
        tags.push(rule.tag);
        matchedTexts.push(match[0]);
        break;
      }
    }
  }
  return { tags: tags.filter((tag, index) => tags.indexOf(tag) === index), matchedTexts };
}

function buildRuleBasedReply(newTags: SymptomTag[], findings: Finding[], isNewFall: boolean, context?: AgentContext): string {
  const urgent = context?.priorityFindings.find((finding) => finding.severity === 'urgent');
  if (urgent && newTags.some((tag) => ['chestPain', 'neuroChange', 'fall'].includes(tag))) {
    return `先别做别的：${urgent.title}。${urgent.detail}`;
  }
  if (newTags.includes('chestPain')) {
    return INTENT_RULES.find((rule) => rule.tag === 'chestPain')?.replies[0] ?? '先停止活动并保持安全姿势，必要时立即寻求急救。';
  }
  if (newTags.includes('neuroChange')) {
    return INTENT_RULES.find((rule) => rule.tag === 'neuroChange')?.replies[0] ?? '先别走动，立即联系家里人并寻求急救。';
  }
  if (newTags.includes('fall')) {
    const reply = INTENT_RULES.find((rule) => rule.tag === 'fall')?.replies[0];
    if (reply) return reply;
  }
  if (newTags.length === 0) {
    const changes = context?.personTwin.safetyRelevantChanges ?? [];
    return changes.length ? `我在听。我最近也留意到${changes.slice(0, 3).join('、')}。您有什么不舒服，直接告诉我就好。` : '我在听。身体有什么不舒服，或者最近走路、睡觉有变化，都可以直接告诉我。';
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
  if (fusion && (newTags.includes('fatigue') || newTags.includes('dyspnea'))) parts.push(`另外我留意了一下：${fusion.evidence[0]}。我会继续帮您观察变化。`);
  if (isNewFall) parts.push('我已经把跌倒标成紧急事件了，请先保持电话畅通。');
  return parts.join('\n');
}

export interface LlmAdapter {
  complete(systemPrompt: string, userText: string, context?: AgentContext): Promise<{ text: string; tags: SymptomTag[] }>;
}

export const ruleBasedAdapter: LlmAdapter = {
  async complete(_systemPrompt, userText, context) {
    const parsed = parseElderInput(userText);
    return { text: buildRuleBasedReply(parsed.tags, [], parsed.tags.includes('fall'), context), tags: parsed.tags };
  },
};

function sanitizeExternalContext(context: AgentContext): AgentContext {
  const publicFindings = context.priorityFindings.filter((finding) => finding.familyEligible !== false);
  const safetyRank: Record<Finding['severity'], number> = { urgent: 0, alert: 1, watch: 2, info: 3 };
  const publicSafety = publicFindings.reduce<Finding['severity']>(
    (highest, finding) => (safetyRank[finding.severity] < safetyRank[highest] ? finding.severity : highest),
    'info',
  );
  const publicSymptoms = context.observations
    .filter((observation) => observation.visibility !== 'private')
    .flatMap((observation) => observation.tags)
    .filter((tag, index, tags) => tags.indexOf(tag) === index);
  return {
    ...context,
    safetyLevel: publicSafety,
    personTwin: {
      ...context.personTwin,
      activity: 'unknown',
      mobility: 'unknown',
      sleep: 'unknown',
      nightActivity: 'unknown',
      recentSymptoms: publicSymptoms,
      activeConcerns: publicFindings.map((finding) => finding.title).slice(0, 4),
      safetyRelevantChanges: [],
    },
    metrics: context.metrics.filter((metric) => metric.visibility !== 'private'),
    observations: context.observations.filter((observation) => observation.visibility !== 'private'),
    labs: context.labs.filter((lab) => lab.visibility !== 'private'),
    priorityFindings: publicFindings,
    suggestedAction: undefined,
  };
}

export function createHttpLlmAdapter(endpoint: string): LlmAdapter {
  if (!endpoint.startsWith('/') && !endpoint.startsWith('https://') && !endpoint.startsWith('http://localhost')) {
    throw new Error('LLM endpoint must be a same-origin path, HTTPS URL, or localhost during development.');
  }
  return {
    async complete(systemPrompt, userText, context) {
      const safeContext = context ? sanitizeExternalContext(context) : undefined;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt, userText, context: safeContext }),
      });
      if (!response.ok) throw new Error(`LLM endpoint returned ${response.status}`);
      const payload = (await response.json()) as { text?: string; tags?: SymptomTag[] };
      return { text: payload.text ?? '', tags: payload.tags ?? parseElderInput(userText).tags };
    },
  };
}

const SYSTEM_PROMPT = '你是老人家庭健康助手。只解释已发现的变化和日常状态，不做疾病诊断。安全等级与是否需要升级由规则引擎决定。回答要短、温和、易听懂；有理由才追问。';

const UNSAFE_REPLY_PATTERNS = [/^\s*(诊断为|确诊为|您可能患有|你可能患有|您得了|你得了)/, /(就是|一定是|肯定是)(心衰|心脏病|脑卒中|中风|肺炎|感染)/];
const MAX_AGENT_REPLY_LENGTH = 500;

export function isSafeAgentReply(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || normalized.length > MAX_AGENT_REPLY_LENGTH) return false;
  return !UNSAFE_REPLY_PATTERNS.some((pattern) => pattern.test(normalized));
}

export async function generateAgentReply(elderText: string, newTags: SymptomTag[], findings: Finding[], isNewFall: boolean, context?: AgentContext, adapter: LlmAdapter = ruleBasedAdapter): Promise<string> {
  const safetyFinding = context?.priorityFindings.find(
    (finding) => (finding.severity === 'urgent' || finding.severity === 'alert') && finding.familyEligible !== false,
  );
  const safetyGuard = safetyFinding ? `当前最高风险等级为 ${safetyFinding.severity}，不要自行提高或降低等级。` : '当前没有可供外部模型使用的更高等级安全信号。';
  const systemPrompt = `${SYSTEM_PROMPT}\n${safetyGuard}\n已识别标签：${newTags.join(', ') || '无'}。`;
  try {
    const completion = await adapter.complete(systemPrompt, elderText, context);
    if (isSafeAgentReply(completion.text)) return completion.text.trim();
    return buildRuleBasedReply(newTags, findings, isNewFall, context);
  } catch {
    return buildRuleBasedReply(newTags, findings, isNewFall, context);
  }
}

export const QUICK_INPUTS = ['最近腿有点没劲', '最近走路有点喘', '这两天睡不好', '我有点头晕', '药忘记吃了', '刚才摔了一跤'];

export function msg(role: ChatMessage['role'], text: string, time: string, persisted = true): ChatMessage {
  return { id: `${role}-${time}-${Math.random().toString(36).slice(2, 8)}`, role, text, time, persisted };
}

export function tagLabel(tag: SymptomTag): string {
  return SYMPTOM_LABELS[tag];
}
