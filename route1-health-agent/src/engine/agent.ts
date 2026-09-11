/** 对话 Agent：规则负责识别与安全边界，Adapter 负责最终措辞。 */
import type { ChatMessage, Finding, SymptomTag } from '../types';
import type { AgentContext } from './context';
import { SYMPTOM_LABELS } from '../types';
import { suggestFollowUpQuestions } from './questions';
import { parsePrivacyIntent } from './privacy';

interface IntentRule {
  tag: SymptomTag;
  patterns: RegExp[];
  replies: string[];
}

const BP_NUMBER = '(?:\\d{2,3}|[零〇一二两三四五六七八九十百千万]+)';

const INTENT_RULES: IntentRule[] = [
  {
    tag: 'fatigue',
    patterns: [/很?累/, /乏/, /没(有)?劲/, /提不起(精神|劲)/, /体力(不|跟不)上/],
    replies: ['先歇一歇，别硬撑。您如果愿意，可以告诉我这种累是从什么时候开始的。'],
  },
  {
    tag: 'dyspnea',
    patterns: [/喘/, /气(短|不够|促)/, /憋气/, /上(楼|台阶)(费劲|吃力|喘)/],
    replies: ['别着急，慢慢说。我先记下您现在说的感觉，可以再告诉我是静坐时还是活动时更明显。'],
  },
  {
    tag: 'poorSleep',
    patterns: [/睡不(好|着|踏实)/, /没睡好/, /失眠/, /夜醒/, /起夜/, /半夜(醒|起来)/],
    replies: ['睡不好确实难受，我记下了。我想再确认一个情况。'],
  },
  {
    tag: 'edema',
    patterns: [/(脚|腿|脚踝|小腿).{0,4}肿/, /肿了/, /鞋(紧|挤脚)/, /袜子(印|勒)/],
    replies: ['我记下了。脚踝或腿部的肿胀如果持续或越来越明显，建议尽快和医生沟通。'],
  },
  {
    tag: 'dizziness',
    patterns: [/头晕/, /头.{0,2}晕/, /头昏/, /站不稳/, /眼前发黑/, /天旋地转/],
    replies: ['先坐稳，别硬站着。我想确认一下，这样更容易判断当下行动是否安全。'],
  },
  {
    tag: 'medicationMissed',
    patterns: [/(忘|没|漏)(了)?(吃|服|用).{0,3}药/, /药忘/, /忘了.{0,3}药/],
    replies: ['先别自行加量补吃，按原来的医生方案处理。'],
  },
  {
    tag: 'bpHigh',
    patterns: [
      /血压\s*(?:有)?(?:高|偏高)/,
      new RegExp(`高压\\s*${BP_NUMBER}`),
      new RegExp(`低压\\s*${BP_NUMBER}`),
      new RegExp(`血压\\s*${BP_NUMBER}\\s*[/／,，、比\\-至~]\\s*${BP_NUMBER}`),
      new RegExp(`高低压\\s*${BP_NUMBER}\\s*[/／,，、比\\-至~]\\s*${BP_NUMBER}`),
      new RegExp(`收缩压\\s*${BP_NUMBER}.{0,4}舒张压\\s*${BP_NUMBER}`),
      new RegExp(`舒张压\\s*${BP_NUMBER}.{0,4}收缩压\\s*${BP_NUMBER}`),
    ],
    replies: ['先坐下来安静一会儿，再按设备说明复测。单次读数不要自己下结论。'],
  },
  {
    tag: 'chestPain',
    patterns: [/胸(口)?痛/, /胸疼/, /胸闷/, /胸(口)?.{0,5}(痛|疼)/, /胸口.{0,4}(压迫|压着|紧)/, /心口痛/],
    replies: ['先停止活动并保持安全姿势。如果胸痛明显或持续，尤其伴喘、冷汗、头晕，应立即寻求急救。'],
  },
  {
    tag: 'neuroChange',
    patterns: [
      /说话(不清楚|含糊|不利索)/,
      /(嘴角|嘴).{0,3}(歪|偏)/,
      /(一侧|半边|一边).{0,4}(无力|没劲|发麻|麻木)/,
      /(手脚|胳膊|腿).{0,4}(突然)?(无力|没劲|发麻|麻木)/,
      /突然看不清/,
    ],
    replies: ['先别走动，立即联系家里人并寻求急救。这类突然出现的情况不适合在家继续观察。'],
  },
  {
    tag: 'pain',
    patterns: [/(疼|痛)/, /不舒服/],
    replies: ['哪里不舒服可以慢慢告诉我：位置、持续多久，以及什么时候最明显。'],
  },
  {
    tag: 'moodLow',
    patterns: [/(心|心情)(烦|闷|不好)/, /没意思/, /孤独/, /想(孩子|家里人)/],
    replies: ['我在这儿，您慢慢说。'],
  },
  {
    tag: 'fall',
    patterns: [/(摔|跌)(倒|了一跤|了一下|过一次|摔过|过了|了)/, /摔倒/],
    replies: ['先别急着起身，先确认有没有明显疼痛、出血、意识异常或站不起来。'],
  },
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

function buildRuleBasedReply(
  newTags: SymptomTag[],
  findings: Finding[],
  isNewFall: boolean,
  context?: AgentContext,
): string {
  const replyFor = (tag: SymptomTag): string =>
    INTENT_RULES.find((rule) => rule.tag === tag)?.replies[0] ??
    `我记下了：${SYMPTOM_LABELS[tag] ?? '您刚才说的情况'}。`;

  if (newTags.includes('chestPain')) return replyFor('chestPain');
  if (newTags.includes('neuroChange')) return replyFor('neuroChange');
  if (newTags.includes('fall')) {
    const base = replyFor('fall');
    return isNewFall ? `${base} 请先确认自己现在是否安全。` : base;
  }
  if (newTags.includes('bpHigh')) return replyFor('bpHigh');
  if (newTags.length === 0) {
    const unresolved = context?.priorityFindings.find((finding) => finding.severity === 'urgent');
    return unresolved
      ? `我先回答您现在说的内容。还有一件之前需要继续确认的事情：${unresolved.title}。`
      : '我在听。身体有什么不舒服，或者最近走路、睡觉有变化，都可以直接告诉我。';
  }
  const parts = newTags.slice(0, 2).map(replyFor);
  if (context) {
    const followUps = suggestFollowUpQuestions(newTags, context);
    if (followUps.length > 0) parts.push(followUps[0].question);
  }
  if (findings.some((finding) => finding.severity === 'urgent') && isNewFall) parts.push('请先确认自己现在是否安全。');
  return parts.join('\n');
}
