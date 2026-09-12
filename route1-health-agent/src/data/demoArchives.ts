/** Generated, conspicuously labelled documents; never written into personal attachment storage. */
export function demoArchives() {
  const entries = [
    [
      '体检报告',
      '年度健康体检摘要',
      [
        '姓名：王秀兰（虚构）    女 / 72 岁',
        '血压：134 / 82 mmHg    静息心率：72 次/分',
        '体重：62.3 kg    血氧：96%',
        '演示故事：早期基线相对平稳，近期活动和夜间状态出现变化。',
      ],
    ],
    [
      '就诊记录',
      '社区心血管随访记录',
      [
        '随访对象：王秀兰（虚构）',
        '既往情况：高血压、心功能减退随访中',
        '用药档案：氨氯地平、美托洛尔',
        '演示待办：向家属说明近期活动减少，整理记录供就诊参考。',
      ],
    ],
    [
      '检验检查',
      '常规检验项目摘要',
      [
        '检验结果示例：血红蛋白 128 g/L',
        '空腹血糖 5.6 mmol/L',
        '血肌酐 72 μmol/L',
        '这些是界面展示用数值，不是检测结果或诊断结论。',
      ],
    ],
    [
      '影像资料',
      '胸部影像资料登记单',
      [
        '检查类型：胸部影像（演示条目）',
        '资料状态：已归档示例登记单',
        '本页为资料管理示意，不包含真实医学影像。',
        '原始影像和正式报告需由本人上传。',
      ],
    ],
    [
      '病历资料',
      '慢病管理病历摘要',
      [
        '档案对象：王秀兰（虚构）',
        '基础病：高血压、心功能减退（随访中）',
        '日常情况：使用手杖，夜间视力下降',
        '当前用药详情与“药物”页面保持一致。',
      ],
    ],
    [
      '其他资料',
      '家庭照护与生活记录',
      [
        '家属：女儿李芳（演示人物）',
        '常用药：床头柜抽屉（示例房间位置）',
        '日常记录：步数、睡眠、血压和服药情况',
        '分享健康变化前由老人决定；演示不代表已实际通知。',
      ],
    ],
  ] as const;
  return entries.flatMap(([category, title, lines], index) =>
    [0, 1].map((version) => {
      const date = new Date();
      date.setDate(date.getDate() - index - version * 14);
      const name = `${title}${version ? '（上次记录）' : ''} · 演示`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="1080" viewBox="0 0 840 1080"><rect width="840" height="1080" fill="#f4f8ff"/><rect x="40" y="40" width="760" height="1000" rx="24" fill="white"/><rect x="70" y="80" width="700" height="55" rx="12" fill="#e7f1ff"/><text x="95" y="116" fill="#276bc2" font-family="sans-serif" font-size="24">模拟资料 · 仅用于产品演示 · 非真实医疗文件</text><text x="75" y="200" font-family="sans-serif" font-size="32" fill="#172e4d">${title}</text><text x="75" y="250" font-family="sans-serif" font-size="22" fill="#687c92">${category} / ${date.toLocaleDateString('zh-CN')}</text>${lines.map((line, i) => `<text x="75" y="${340 + i * 85}" font-family="sans-serif" font-size="21" fill="#30465e">${line}</text>`).join('')}<path d="M75 755H765" stroke="#dce7f4"/><text x="75" y="815" font-family="sans-serif" font-size="22" fill="#647b93">阿安 · 健康档案展示样本</text><text x="75" y="875" font-family="sans-serif" font-size="20" fill="#647b93">本文件可预览与下载，全部人物及数值均为模拟。</text></svg>`;
      return {
        id: `demo-archive-${index}-${version}`,
        name,
        category,
        date: date.toISOString(),
        file: new File([svg], `${name}.svg`, { type: 'image/svg+xml' }),
      };
    }),
  );
}
