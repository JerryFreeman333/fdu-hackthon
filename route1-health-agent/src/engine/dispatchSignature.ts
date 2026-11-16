import type { Finding } from '../types';

/**
 * 派发 effect 的变更签名。
 *
 * 必须包含 `date`：家人安全事件的 findingId 在“今天/昨天”窗口内保持不变，
 * 隔天重申时标题、正文和严重度都可能完全一样；如果签名里没有日期，页面
 * 跨午夜后派发 effect 不会重跑，“今天再推一次”就永远不执行。
 *
 * 普通 finding 的 date 每天也变化，但派发引擎会按 findingId 去重，
 * 同级且未升级的普通 finding 不会被重复外送。
 */
export function dispatchSignature(findings: Finding[], oneTimeSharedFindingIds: string[]): string {
  const oneTime = [...new Set(oneTimeSharedFindingIds)].sort().join(',');
  const parts = findings
    .filter((finding) => finding.severity === 'alert' || finding.severity === 'urgent')
    .map(
      (finding) =>
        `${finding.id}:${finding.date}:${finding.severity}:${
          finding.familyEligible !== false ? 'eligible' : 'blocked'
        }:${finding.familyMessage ? 'msg' : 'nomsg'}:${finding.title}:${finding.familyMessage ?? ''}`,
    )
    .sort()
    .join('|');
  return `${oneTime}|${parts}`;
}
