import type { ElderProfile } from '../types';
import type { HomeTwinConnection } from '../hooks/useHomeTwinIntegration';

interface ElderHomeSpacePageProps {
  profile: ElderProfile;
  homeTwinUrl: string;
  connection: HomeTwinConnection;
  onRetry: () => void;
  onFindItem: (query: string) => void;
  onAsk: (prompt: string) => void;
}

function residentHomeUrl(base: string): string {
  try {
    const url = new URL(base, window.location.href);
    url.searchParams.set('role', 'resident');
    url.searchParams.set('view', 'home');
    url.searchParams.set('returnUrl', window.location.href);
    return url.toString();
  } catch {
    return base;
  }
}

export default function ElderHomeSpacePage({
  profile,
  homeTwinUrl,
  connection,
  onRetry,
  onFindItem,
  onAsk,
}: ElderHomeSpacePageProps) {
  function find(query: string) {
    onFindItem(query);
  }
  return (
    <div className="home-space-page">
      <header className="page-title-block">
        <span className="page-kicker">我的家</span>
        <h1>先把您的家记录下来</h1>
        <p>进入家庭空间后，按指引打开摄像头拍摄房间，上传视频建立自己的模型。已创建的空间可以继续查看进度和结果。</p>
      </header>

      <section className="space-hero card">
        <div className="space-house-mark" aria-hidden="true">
          <span />
        </div>
        <div>
          <span className={`space-ready home-twin-${connection.status}`}>{connection.detail}</span>
          <h2>拍摄房间，建立家庭空间</h2>
          <p>打开摄像头 → 按指引拍摄 → 上传建模 → 查看自己的房间</p>
        </div>
      </section>

      <section className="life-help-grid" aria-label="生活帮助">
        <button type="button" onClick={() => void find('常用药')}>
          <span className="life-help-index">01</span>
          <strong>找药</strong>
          <small>{profile.medications.length > 0 ? '查找已记录的常用药' : '先告诉我药物名称'}</small>
        </button>
        <button type="button" onClick={() => void find('眼镜')}>
          <span className="life-help-index">02</span>
          <strong>找东西</strong>
          <small>眼镜、钥匙、手机</small>
        </button>
        <button type="button" onClick={() => onAsk('晚上去卫生间怎么走更安全？')}>
          <span className="life-help-index">03</span>
          <strong>问路线</strong>
          <small>获得简短的家庭提示</small>
        </button>
      </section>

      {connection.status === 'offline' && (
        <button className="btn-secondary" type="button" onClick={onRetry}>
          重新连接家庭空间
        </button>
      )}

      <a className="btn-primary open-home-twin" href={residentHomeUrl(homeTwinUrl)}>
        进入家庭空间 · 拍摄或查看
      </a>
      <p className="home-space-note">当前页面不会向老人展示风险分数、算法名称或复杂 3D 操作。</p>
    </div>
  );
}
