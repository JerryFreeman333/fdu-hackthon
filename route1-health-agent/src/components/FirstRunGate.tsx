interface FirstRunGateProps {
  onDemo: () => void;
  onPersonal: () => void;
}

/**
 * 首启身份选择（评审 P0-4/P1-2）。
 * 新用户的第一个问题曾是"我是谁？——你是王秀兰奶奶"。现在必须先问用户：
 * 是快速看演示，还是自己真正开始用。两者从此是显式选择，不是同一份写死档案。
 */
export default function FirstRunGate({ onDemo, onPersonal }: FirstRunGateProps) {
  return (
    <div className="role-gate">
      <div className="role-card">
        <div className="role-kicker">阿安 · 老人家庭助手</div>
        <h1>先选一下怎么开始</h1>
        <p className="role-lead">所有数据都只保存在这台浏览器里，不会上传。</p>
        <div className="role-grid">
          <button className="role-option" onClick={onDemo}>
            <span className="role-icon">👵</span>
            <strong>体验演示档案</strong>
            <span>王秀兰奶奶 · 预置 21 天数据，快速看完整演示</span>
          </button>
          <button className="role-option" onClick={onPersonal}>
            <span className="role-icon">🙋</span>
            <strong>这是我自己用</strong>
            <span>三步建档，从空白开始记录真实情况</span>
          </button>
        </div>
        <p className="role-note">演示档案里的数据是模拟的；自己用的档案从空白开始，由您和家人的真实记录组成。</p>
      </div>
    </div>
  );
}
