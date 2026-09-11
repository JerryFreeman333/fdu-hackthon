export type JourneyRole = 'resident' | 'family';

export interface JourneyStep {
  id: string;
  title: string;
  description: string;
  state: 'done' | 'current' | 'next';
}

export function buildJourney(role: JourneyRole, hasHomeModel: boolean): JourneyStep[] {
  if (role === 'resident') {
    return [
      { id: 'home-ready', title: '家庭已准备好', description: hasHomeModel ? '系统已经有您的家庭空间记录。' : '先由家人完成家庭空间建立。', state: hasHomeModel ? 'done' : 'current' },
      { id: 'find', title: '需要什么就找什么', description: '直接找眼镜、钥匙等常用物品。', state: hasHomeModel ? 'current' : 'next' },
      { id: 'help', title: '需要帮助时交给家人', description: '复杂的居家问题不要求您自己判断。', state: 'next' },
    ];
  }
  return [
    { id: 'create', title: '建立家庭空间', description: hasHomeModel ? '家庭空间已经建立，可以继续查看。' : '由子女或照护者完成一次家庭采集。', state: hasHomeModel ? 'done' : 'current' },
    { id: 'review', title: '发现需要关注的问题', description: '系统基于已有空间证据整理风险，并解释影响范围。', state: hasHomeModel ? 'current' : 'next' },
    { id: 'act', title: '处理并重新确认', description: '处理完成后重新扫描，只有证据支持风险消失才关闭事项。', state: 'next' },
    { id: 'return', title: '持续回访', description: '后续只需关注变化和待处理事项，不必重复理解整套系统。', state: 'next' },
  ];
}
