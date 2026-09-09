import type { HomeSafetyActionPlan } from './actionPlan';
import { parseHomeSafetyActionPlan, applyRescan } from './actionPlan';
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
  return {
    status: 'idle',
    batch: null,
    previousPlan: null,
    currentPlan: null,
    message: '等待新的房间照片或视频。',
  };
}

export function loadDemoActionPlan(raw: unknown): HomeSafetyActionPlan | null {
  return parseHomeSafetyActionPlan(raw);
}

export function selectRescanBatch(
  state: RescanWorkflowState,
  batch: RescanInputBatch,
): RescanWorkflowState {
  return {
    ...state,
    status: batch.status === 'selected' ? 'selected' : state.status,
    batch,
    message: `已选择 ${batch.files.length} 个复扫文件。下一步提交给 Home Twin 重建。`,
  };
}

export function markSubmitted(state: RescanWorkflowState): RescanWorkflowState {
  if (!state.batch) return { ...state, status: 'failed', message: '没有可提交的复扫输入。' };
  return {
    ...state,
    status: 'processing',
    batch: { ...state.batch, status: 'submitted' },
    message: '复扫已提交。当前浏览器仅完成输入接收；真实 COLMAP / 3DGS 重建应由本地或服务端管线执行。',
  };
}

export function applyRescanProjection(
  state: RescanWorkflowState,
  latestRiskIds: string[],
): RescanWorkflowState {
  if (!state.previousPlan) {
    return { ...state, status: 'failed', message: '缺少上一轮家庭行动计划，无法比较复扫结果。' };
  }
  const currentPlan = applyRescan(state.previousPlan, latestRiskIds);
  return {
    ...state,
    status: 'ready-for-review',
    currentPlan,
    message:
      currentPlan.status === 'clear'
        ? '复扫确认：上一轮行动对应风险已消失。'
        : '复扫完成：仍有风险或出现新的风险，请继续检查。',
  };
}
