import type { ElderProfile, UserRole } from '../types';
import ProfileForm from './ProfileForm';
import { emptyProfile } from '../store/profileStore';

interface OnboardingFlowProps {
  onComplete: (profile: ElderProfile) => void;
  role: UserRole;
}

/** 首启建档（评审 P0-4）：新用户的第一个问题不能是"你是王秀兰奶奶"。 */
export default function OnboardingFlow({ onComplete, role }: OnboardingFlowProps) {
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
