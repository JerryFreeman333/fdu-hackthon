import { parseHomeSafetyActionPlan, type HomePlanProvenance, type HomeSafetyActionPlan } from './actionPlan';
import type { RescanInputBatch } from './rescanInput';

export type RescanJobStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface RescanSubmitResponse {
  status: RescanJobStatus;
  jobId?: string;
  message?: string;
  latestRiskIds?: string[];
  actionPlan?: HomeSafetyActionPlan;
  provenance?: { current: HomePlanProvenance; previous: HomePlanProvenance | null };
}

export interface RescanUploadOptions {
  endpoint?: string;
  signal?: AbortSignal;
}

export interface RescanJobOptions {
  endpoint?: string;
  signal?: AbortSignal;
}

function parseResponse(payload: unknown): RescanSubmitResponse {
  if (!payload || typeof payload !== 'object') {
    throw new Error('复扫服务返回了无效响应');
  }
  const result = payload as Record<string, unknown>;
  const status = result.status;
  if (!['queued', 'processing', 'ready', 'failed'].includes(String(status))) {
    throw new Error('复扫服务返回了无效状态');
  }

  const rawActionPlan = result.actionPlan;
  const actionPlan = rawActionPlan === undefined ? undefined : parseHomeSafetyActionPlan(rawActionPlan);
  if (rawActionPlan !== undefined && !actionPlan) {
    throw new Error('复扫服务返回的行动计划无效，拒绝更新风险状态');
  }
  if (actionPlan && !actionPlan.provenance?.current) {
    throw new Error('复扫服务行动计划缺少当前 provenance，拒绝自动关闭历史风险');
  }

  return {
    status: status as RescanJobStatus,
    jobId: typeof result.jobId === 'string' ? result.jobId : undefined,
    message: typeof result.message === 'string' ? result.message : undefined,
    latestRiskIds: Array.isArray(result.latestRiskIds)
      ? result.latestRiskIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    actionPlan: actionPlan ?? undefined,
    provenance: actionPlan?.provenance,
  };
}

async function fetchJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function submitRescanBatch(
  batch: RescanInputBatch,
  files: File[],
  options: RescanUploadOptions = {},
): Promise<RescanSubmitResponse> {
  const endpoint = options.endpoint ?? '/api/route2/rescan';
  const form = new FormData();
  form.append('batchId', batch.id);
  form.append('capturedAt', batch.capturedAt);
  form.append('mediaKind', batch.kind);
  form.append(
    'manifest',
    JSON.stringify({
      id: batch.id,
      capturedAt: batch.capturedAt,
      kind: batch.kind,
      files: batch.files,
    }),
  );
  for (const file of files) form.append('files', file, file.name);

  const response = await fetch(endpoint, {
    method: 'POST',
    body: form,
    signal: options.signal,
  });
  const payload = await fetchJson(response);
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'detail' in payload
      ? String((payload as { detail?: unknown }).detail)
      : payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message?: unknown }).message)
        : `HTTP ${response.status}`;
    throw new Error(`复扫上传失败: ${detail}`);
  }
  return parseResponse(payload);
}

export async function getRescanJob(
  jobId: string,
  options: RescanJobOptions = {},
): Promise<RescanSubmitResponse> {
  const endpoint = (options.endpoint ?? '/api/route2/rescan').replace(/\/$/, '');
  const response = await fetch(`${endpoint}/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    signal: options.signal,
  });
  const payload = await fetchJson(response);
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'detail' in payload
      ? String((payload as { detail?: unknown }).detail)
      : `HTTP ${response.status}`;
    throw new Error(`复扫状态查询失败: ${detail}`);
  }
  return parseResponse(payload);
}

export async function waitForRescanJob(
  jobId: string,
  options: RescanJobOptions & { intervalMs?: number; maxAttempts?: number } = {},
): Promise<RescanSubmitResponse> {
  const intervalMs = options.intervalMs ?? 1000;
  const maxAttempts = options.maxAttempts ?? 90;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await getRescanJob(jobId, options);
    if (result.status === 'ready' || result.status === 'failed') return result;
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }
  throw new Error('复扫处理等待超时；本次未改变现有 Home Twin 状态。');
}
