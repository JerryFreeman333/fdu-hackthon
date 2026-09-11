import type { UserRole } from '../types';

interface RoleGateProps {
  onSelect: (role: UserRole) => void;
}

export default function RoleGate({ onSelect }: RoleGateProps) {
  return (
    <div className="role-gate">
      <div className="role-card">
        <div className="role-kicker">阿安 · 老人家庭助手</div>
        <h1>有事情，直接告诉我</h1>
        <p className="role-lead">身体不舒服、忘了吃药、想记件事情，或者想让家里人知道，都可以直接跟我说。</p>
        <div className="role-grid">
          <button className="role-option" onClick={() => onSelect('elder')}>
            <span className="role-icon">👵</span>
            <strong>我是老人</strong>
            <span>直接说一说今天的情况</span>
          </button>
          <button className="role-option" onClick={() => onSelect('family')}>
            <span className="role-icon">👨‍👩‍👧</span>
            <strong>我是家属</strong>
            <span>看看老人现在需不需要您的帮助</span>
          </button>
        </div>
        <p className="role-note">这是演示版，主要功能都可以先在这台设备上体验。</p>
      </div>
    </div>
  );
}
