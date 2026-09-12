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
 */
export default function FirstRunGate({ onDemo, onPersonal }: FirstRunGateProps) {
  const [role, setRole] = useState<UserRole | null>(null);
  return (
    <div className="role-gate">
      <div className="role-card">
        <div className="role-kicker">阿安 · 老人家庭助手</div>
        <h1>{role ? '选择真实使用或演示' : '你好，我们还不知道你是谁'}</h1>
        <p className="role-lead">
          {role ? '真实使用从空白建档；演示档案必须由你主动选择。' : '请先告诉我们你将以哪种身份使用，系统不会猜测。'}
        </p>
        <div className="role-grid">
          {!role ? (
            <>
              <button className="role-option" onClick={() => setRole('elder')}>
                <span className="role-icon">本人</span>
                <strong>我是老人/本人</strong>
                <span>记录自己的情况并获得帮助</span>
              </button>
              <button className="role-option" onClick={() => setRole('family')}>
                <span className="role-icon">家属</span>
                <strong>我是家属</strong>
                <span>绑定并协助一位老人</span>
              </button>
            </>
          ) : (
            <>
              <button className="role-option" onClick={() => onPersonal(role)}>
                <span className="role-icon">真实</span>
                <strong>创建真实档案</strong>
                <span>从空白开始，不注入任何预置健康数据</span>
              </button>
              <button className="role-option" onClick={() => onDemo(role)}>
                <span className="role-icon">演示</span>
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
