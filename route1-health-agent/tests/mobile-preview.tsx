import React from 'react';
import { createRoot } from 'react-dom/client';
import ElderHome from '../src/components/ElderHome';
import { emptyProfile } from '../src/engine/profile';
import '../src/styles.css';
import '../src/styles-accessibility.css';
document.body.dataset.fontScale = new URLSearchParams(location.search).get('size') || 'normal';
const tasks = ['确认现在是否安全', '记录今天的血压', '看看今晚是否睡好'].map((title, i) => ({
  id: String(i),
  title,
  description: i === 0 ? '先别急着起来，确认是否受伤；需要时请联系身边的人。' : '方便的时候再做，不用着急。',
  dueDate: '2026-09-08',
  createdAt: '2026-09-08',
  status: 'pending' as const,
  kind: 'observation' as const,
}));
createRoot(document.getElementById('root')!).render(
  <div className="app">
    <header className="simple-header">
      <div>阿安 · 老人端</div>
      <button className="btn-secondary">家属已绑定 · 已共享</button>
    </header>
    <main className="content">
      <ElderHome
        profile={{ ...emptyProfile, name: '测试奶奶' }}
        chat={[
          { id: '1', role: 'elder', text: '我刚才摔了一下', time: '10:00' },
          {
            id: '2',
            role: 'agent',
            text: '已记录：我刚才摔了一下。\n记录时家属可在报告中查看，不代表已读。\n现在先确认是否受伤。',
            time: '10:00',
          },
        ]}
        onSend={() => {}}
        quickInputs={[]}
        tasks={tasks}
        findings={[]}
        pending={false}
        failedText=""
        onRetry={() => {}}
        onTaskStatus={() => {}}
      />
    </main>
  </div>,
);
