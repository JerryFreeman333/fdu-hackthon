import type { ElderProfile, UserRole } from '../types';
import ProfileForm from './ProfileForm';
import { emptyProfile } from '../store/profileStore';
import { useState } from 'react';

interface OnboardingFlowProps {
  onComplete: (profile: ElderProfile) => void;
  role: UserRole;
}

/** 首启建档（评审 P0-4）：新用户的第一个问题不能是"你是王秀兰奶奶"。 */
export default function OnboardingFlow({ onComplete, role }: OnboardingFlowProps) {
  const [start, setStart] = useState(false);
  const [notice, setNotice] = useState('');
  if (!start)
    return (
      <div className="role-gate">
        <section className="role-card">
          <div className="role-kicker">第一次使用 · 账号与授权</div>
          <h1>欢迎使用阿安</h1>
          <p>先选择登录方式，再建立您自己的档案。</p>
          <button
            className="btn-primary"
            onClick={() =>
              setNotice('微信授权服务尚未配置，目前无法真实登录。可以先创建本机档案；这不等同于微信登录。')
            }
          >
            微信授权登录
          </button>
          {notice && <p role="status">{notice}</p>}
          <button className="btn-secondary" onClick={() => setStart(true)}>
            暂不登录，先创建本机档案
          </button>
          <p className="muted">健康数据共享需要在支持的手机端单独授权，建档不会自动读取手机健康数据。</p>
        </section>
      </div>
    );
  return (
    <div className="role-gate">
      <div className="role-card onboarding-card">
        <div className="role-kicker">第一次使用</div>
        <h1>{role === 'elder' ? '先认识一下您' : '先填写您要照护的老人'}</h1>
        <p className="role-lead">系统现在没有预设任何人。请填写称呼；其余信息可以稍后补充。</p>
        <ProfileForm initial={emptyProfile()} submitLabel="好了，开始使用" onSubmit={onComplete} />
      </div>
    </div>
  );
}
