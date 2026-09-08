import type { CareTask, ChatMessage, ElderProfile, Finding } from '../types';
import ChatView from './ChatView';

interface ElderHomeProps {
  profile: ElderProfile;
  chat: ChatMessage[];
  onSend: (text: string) => void | Promise<void>;
  quickInputs: string[];
  tasks: CareTask[];
  findings: Finding[];
  pending: boolean;
  failedText: string;
  onRetry: () => void;
  onTaskStatus: (id: string, status: CareTask['status']) => void;
}
export default function ElderHome(props: ElderHomeProps) {
  const active = props.tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  const urgentIds = new Set(props.findings.filter((f) => f.severity === 'urgent').map((f) => f.id));
  active.sort(
    (a, b) => Number(urgentIds.has(b.sourceFindingId ?? '')) - Number(urgentIds.has(a.sourceFindingId ?? '')),
  );
  const mainTasks = active.filter((task, index) => index === 0 || urgentIds.has(task.sourceFindingId ?? ''));
  const otherTasks = active.filter((task) => !mainTasks.includes(task));
  return (
    <div className="elder-home">
      <section className="welcome">
        <div className="eyebrow">阿安 · 您的日常助手</div>
        <h1>{props.profile.name ? `${props.profile.name}，` : ''}今天想聊些什么？</h1>
        <p>慢慢说，我会帮您记下重要的事情。</p>
      </section>
      <ChatView
        chat={props.chat}
        onSend={props.onSend}
        quickInputs={props.quickInputs}
        pending={props.pending}
        failedText={props.failedText}
        onRetry={props.onRetry}
      />
      <section className="card">
        <div className="section-head">
          <h2>今天最重要的事</h2>
        </div>
        {active.length === 0 ? (
          <p className="muted">目前没有待处理事项。有需要时，直接告诉我。</p>
        ) : (
          mainTasks.map((task) => (
            <div className="task-item" key={task.id}>
              <div className="task-copy">
                <strong>{task.title}</strong>
                <p>{task.description}</p>
              </div>
              <div className="task-actions">
                {task.status === 'pending' && (
                  <button className="btn-secondary" onClick={() => props.onTaskStatus(task.id, 'in_progress')}>
                    我来做这件事
                  </button>
                )}
                <button className="btn-primary" onClick={() => props.onTaskStatus(task.id, 'completed')}>
                  我做到了
                </button>
              </div>
            </div>
          ))
        )}
        {otherTasks.length > 0 && (
          <details>
            <summary>还有 {otherTasks.length} 件事</summary>
            {otherTasks.map((task) => (
              <article key={task.id}>
                <p>{task.title}</p>
                <p>{task.description}</p>
                <button className="btn-secondary" onClick={() => props.onTaskStatus(task.id, 'completed')}>
                  我做到了
                </button>
              </article>
            ))}
          </details>
        )}
        {props.tasks.some((t) => t.status === 'completed') && (
          <details>
            <summary>已完成事项</summary>
            {props.tasks
              .filter((t) => t.status === 'completed')
              .map((t) => (
                <p key={t.id}>✓ {t.title}</p>
              ))}
          </details>
        )}
      </section>
    </div>
  );
}
