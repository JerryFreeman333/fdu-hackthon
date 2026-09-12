import type { ElderProfile } from '../types';

interface ElderHomeSpacePageProps {
  profile: ElderProfile;
  homeTwinUrl: string;
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

export default function ElderHomeSpacePage({ profile, homeTwinUrl, onAsk }: ElderHomeSpacePageProps) {
  return (
    <div className="home-space-page">
      <header className="page-title-block">
        <span className="page-kicker">我的家</span>
        <h1>想找什么，直接告诉我</h1>
        <p>您只看简单结果，房间模型和复杂判断会交给系统与家人处理。</p>
      </header>

      <section className="space-hero card">
        <div className="space-house-mark" aria-hidden="true">
          <span />
        </div>
        <div>
          <span className="space-ready">家庭空间已准备好</span>
          <h2>熟悉的家，更容易找到东西</h2>
          <p>位置不确定时，系统会如实告诉您，不会猜一个答案。</p>
        </div>
      </section>

      <section className="life-help-grid" aria-label="生活帮助">
        <button type="button" onClick={() => onAsk('我的常用药放在哪里？')}>
          <span className="life-help-index">01</span>
          <strong>找药</strong>
          <small>{profile.medications.length > 0 ? '查找已记录的常用药' : '先告诉我药物名称'}</small>
        </button>
        <button type="button" onClick={() => onAsk('帮我找一下眼镜在哪里？')}>
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

      <a className="btn-primary open-home-twin" href={residentHomeUrl(homeTwinUrl)}>
        打开我的家
      </a>
      <p className="home-space-note">当前页面不会向老人展示风险分数、算法名称或复杂 3D 操作。</p>
    </div>
  );
}
