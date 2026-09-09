import type { HomeSafetyActionPlan } from './actionPlan';
import { acceptRescanActionPlan, parseHomeSafetyActionPlan } from './actionPlan';
import type { RescanInputBatch } from './rescanInput';

export type RescanWorkflowStatus = 'idle' | 'selected' | 'processing' | 'ready-for-review' | 'failed';

export interface RescanWorkflowState {
  status: RescanWorkflowStatus;
  batch: RescanInputBatch | null;
  previousPlan: HomeSafetyActionPlan | null;
  currentPlan: HomeSafetyActionPlan | null;
  message: string;
}

export const RESCAN_STORAGE_KEY = 'route2-home-rescan-workflow-v1';

export function createInitialRescanWorkflow(): RescanWorkflowState {
  return { status: 'idle', batch: null, previousPlan: null, currentPlan: null, message: '等待新的房间照片或视频。' };
}

export function loadDemoActionPlan(raw: unknown): HomeSafetyActionPlan | null {
  return parseHomeSafetyActionPlan(raw);
}

export function sanitizeRestoredWorkflow(raw: unknown): RescanWorkflowState {
  // Browser storage is not a trust boundary. On reload, never restore a resolved
  // action plan as authoritative state; require a fresh server/local-pipeline result.
  const initial = createInitialRescanWorkflow();
  if (!raw || typeof raw !== 'object') return initial;
  const value = raw as Record<string, unknown>;
  const previousPlan = parseHomeSafetyActionPlan(value.previousPlan);
  if (!previousPlan) return initial;
  const restoredStatus = value.status;
  const safeStatus: RescanWorkflowStatus = restoredStatus === 'processing' ? 'processing' : 'idle';
  return {
    ...initial,
    status: safeStatus,
    previousPlan,
    message: safeStatus === 'processing'
      ? '页面重新打开：上一轮复扫状态不可信，必须重新查询新的空间证据。'
      : '已恢复家庭行动基线；未恢复任何自动关闭状态。',
  };
}

export function selectRescanBatch(state: RescanWorkflowState, batch: RescanInputBatch): RescanWorkflowState {
  return { ...state, status: batch.status === 'selected' ? 'selected' : state.status, batch, message: `已选择 ${batch.files.length} 个复扫文件。下一步提交给 Home Twin 重建。` };
}

export function markSubmitted(state: RescanWorkflowState): RescanWorkflowState {
  if (!state.batch) return { ...state, status: 'failed', message: '没有可提交的复扫输入。' };
  return { ...state, status: 'processing', batch: { ...state.batch, status: 'submitted' }, message: '复扫已提交。真实 COLMAP / 3DGS 重建应由本地或服务端管线执行。' };
}

export function applyRescanProjection(state: RescanWorkflowState, result: unknown): RescanWorkflowState {
  if (!state.previousPlan) return { ...state, status: 'failed', message: '缺少上一轮家庭行动计划，无法比较复扫结果。' };
  if (!result || typeof result !== 'object') return { ...state, status: 'failed', message: '复扫结果无效，拒绝更新家庭行动状态。' };

  const payload = result as Record<string, unknown>;
  const currentPlan = parseHomeSafetyActionPlan(payload.actionPlan);
  if (!currentPlan) {
    return { ...state, status: 'failed', message: '复扫结果未提供可验证的行动计划，拒绝仅凭 riskId 更新或关闭历史风险。' };
  }
  const acceptance = acceptRescanActionPlan(state.previousPlan, currentPlan);
  if (!acceptance.accepted) {
    return { ...state, status: 'failed', message: `复扫结果不是当前基线的可信后继：${acceptance.reason}。` };
  }

  return {
    ...state,
    status: 'ready-for-review',
    currentPlan,
    message: currentPlan.status === 'clear'
      ? '复扫确认：上一轮行动对应风险已消失。'
      : '复扫完成：仍有风险或出现新的风险，请继续检查。',
  };
}
