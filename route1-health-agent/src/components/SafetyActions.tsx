import type { ElderProfile } from '../types';

/** 从"女儿 李芳 138****6677"这类联系方式里取称呼，用于拨号按钮文案。 */
export function familyCallLabel(profile: ElderProfile): string {
  const first = profile.familyContact.trim().split(/\s+/)[0];
  return first || '家属';
}

interface SafetyActionsProps {
  profile: ElderProfile;
}

/**
 * 紧急联系行动条：安全指导出现在哪个界面，可按的电话就出现在哪个界面。
 * 老人端此前全项目没有任何 tel: 入口（评审 P0-1），本组件是统一入口：
 * - 120 常驻可用，不依赖档案配置；
 * - 家属 / 社区医生号码缺失时按钮降级为占位提示，不消失——提示该去补档案。
 */
export default function SafetyActions({ profile }: SafetyActionsProps) {
  return (
    <div className="safety-actions" role="group" aria-label="紧急联系电话">
      <a className="safety-btn safety-btn-urgent" href="tel:120">
        📞 呼叫 120
      </a>
      {profile.familyPhone ? (
        <a className="safety-btn" href={`tel:${profile.familyPhone}`}>
          📞 打给{familyCallLabel(profile)}
        </a>
      ) : (
        <span className="safety-btn safety-btn-missing">还没填家属电话</span>
      )}
      {profile.communityDoctorPhone ? (
        <a className="safety-btn" href={`tel:${profile.communityDoctorPhone}`}>
          📞 打给社区医生
        </a>
      ) : (
        <span className="safety-btn safety-btn-missing">还没填医生电话</span>
      )}
    </div>
  );
}
