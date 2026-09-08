import type { UserRole } from '../types';

interface RoleGateProps {
  onSelect: (role: UserRole) => void;
}

export default function RoleGate({ onSelect }: RoleGateProps) {
  return (
    <div className="role-gate">
      <div className="role-card">
        <div className="role-kicker">阿安 · 老人家庭助手</div>
        <h1>欢迎，今天怎么帮您？</h1>
        <p className="role-lead">先选择您的身份。老人可以聊天和看报告，家属可以在获得授权后了解近况。</p>
        <div className="role-grid">
          <button className="role-option" onClick={() => onSelect('elder')}>
            <span className="role-icon">👵</span>
            <strong>我是老人</strong>
            <span>简单说一句，就能获得帮助</span>
          </button>
          <button className="role-option" onClick={() => onSelect('family')}>
            <span className="role-icon">👨‍👩‍👧</span>
            <strong>我是家属</strong>
            <span>只在真正需要时知道该不该介入</span>
          </button>
        </div>
        <p className="role-note">当前为本地体验版，资料保存在这台设备的浏览器中；家庭绑定暂不支持跨设备同步。</p>
      </div>
    </div>
  );
}
