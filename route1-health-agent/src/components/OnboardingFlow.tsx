import type { ElderProfile } from '../types';
import ProfileForm from './ProfileForm';
import { emptyProfile } from '../store/profileStore';

interface OnboardingFlowProps {
  onComplete: (profile: ElderProfile) => void;
}

/** 首启建档（评审 P0-4）：新用户的第一个问题不能是"你是王秀兰奶奶"。 */
export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  return (
    <div className="role-gate">
      <div className="role-card onboarding-card">
        <div className="role-kicker">第一次使用</div>
        <h1>先认识一下您</h1>
        <p className="role-lead">只要三小步：称呼、平时吃的药、家属电话。不想填的都可以跳过，以后随时能改。</p>
        <ProfileForm initial={emptyProfile()} submitLabel="好了，开始使用" onSubmit={onComplete} />
      </div>
    </div>
  );
}
