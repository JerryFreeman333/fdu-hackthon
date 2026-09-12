import { understandingLlmConfigured } from '../config/appConfig';
import { useState } from 'react';
import type { UserRole } from '../types';

interface FirstRunGateProps {
  onDemo: (role: UserRole) => void;
  onPersonal: (role: UserRole) => void;
}

/**
 * 首启身份选择（评审 P0-4/P1-2）。
 * 新用户的第一个问题曾是"我是谁？——你是王秀兰奶奶"。现在必须先问用户：
 * 是快速看演示，还是自己真正开始用。两者从此是显式选择，不是同一份写死档案。
 *
 * P1-6（评审：承诺一致性）："数据只保存在本机"是无条件的承诺，但理解层 LLM
 * 配置后对话内容会发送给服务商——承诺必须与实际行为同步出现，不能只说一半。
 */
export default function FirstRunGate({ onDemo, onPersonal }: FirstRunGateProps) {
  const llmConfigured = understandingLlmConfigured();
  const [role, setRole] = useState<UserRole | null>(null);
  return (
    <div className="role-gate">
      <div className="role-card">
        <div className="role-kicker">阿安 · 老人家庭助手</div>
            <h1>{role ? '接下来怎么开始？' : '先告诉我们你的身份'}</h1>
        <p className="role-lead">
          {role ? '真实使用从空白建档；演示档案必须由你主动选择。' : '请先告诉我们你将以哪种身份使用，系统不会猜测。'}
        </p>
        {llmConfigured && <p className="role-note">已开启智能理解，非私密的对话内容会发送至所配置的 AI 服务商。</p>}
        <div className="role-grid">
          {!role ? (
            <>
              <button className="role-option role-option-elder" onClick={() => setRole('elder')}>
                <span className="role-icon" aria-hidden="true">☀️</span>
                <span className="role-option-tag">老人端</span>
                <strong>我为自己使用</strong>
                <span>记录健康、用药和日常提醒</span>
                <span className="role-option-link">进入老人端 →</span>
              </button>
              <button className="role-option role-option-family" onClick={() => setRole('family')}>
                <span className="role-icon" aria-hidden="true">🤝</span>
                <span className="role-option-tag">子女 / 家属端</span>
                <strong>我来陪伴家人</strong>
                <span>接收重要变化，协助照护父母</span>
                <span className="role-option-link">进入家属端 →</span>
              </button>
            </>
          ) : (
            <>
              <button className="role-option" onClick={() => onPersonal(role)}>
                <span className="role-icon" aria-hidden="true">📝</span>
                <span className="role-option-tag">真实使用</span>
                <strong>创建真实档案</strong>
                <span>从空白开始，不注入任何预置健康数据</span>
              </button>
              <button className="role-option" onClick={() => onDemo(role)}>
                <span className="role-icon" aria-hidden="true">✨</span>
                <span className="role-option-tag">演示体验</span>
                <strong>体验王秀兰演示档案</strong>
                <span>明确使用预置的模拟数据，仅用于体验</span>
              </button>
            </>
          )}
        </div>
        {role && (
          <button className="btn-secondary" onClick={() => setRole(null)}>
            返回选择身份
          </button>
        )}
        <p className="role-note">身份、授权和数据来源都会持续显示；未连接的服务不会伪装成可用。</p>
      </div>
    </div>
  );
}
