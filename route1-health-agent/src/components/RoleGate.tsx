import type { UserRole } from '../types';

interface RoleGateProps {
  onSelect: (role: UserRole) => void;
}

export default function RoleGate({ onSelect }: RoleGateProps) {
  return (
    <div className="role-gate">
      <div className="role-card">
        <div className="role-kicker">老人家庭智能助手 · 路线一</div>
        <h1>先认识人，再理解家</h1>
        <p className="role-lead">现在先把老人本人认识清楚：知道他平时是什么状态，只在出现“和平时不一样”时主动帮忙。</p>
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
        <p className="role-note">
          本 Demo 使用本地模拟数据；未来硬件、OCR、云端服务均通过独立接口接入，不改变 Agent 核心。
        </p>
      </div>
    </div>
  );
}
