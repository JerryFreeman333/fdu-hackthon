import type { RescanInputBatch } from './rescanInput';
import { parseHomeSafetyActionPlan, type HomeSafetyActionPlan } from './actionPlan';

export type RescanJobStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface RescanSubmitResponse {
  status: RescanJobStatus;
  jobId?: string;
  message?: string;
  latestRiskIds?: string[];
  actionPlan?: HomeSafetyActionPlan;
}

export interface RescanUploadOptions {
  endpoint?: string;
  signal?: AbortSignal;
}

export interface RescanJobOptions {
  endpoint?: string;
  signal?: AbortSignal;
}

export interface RescanServiceStatus {
  online: boolean;
  detail?: string;
}

export async function checkRescanService(
  endpoint = '/api/route2/rescan',
  timeoutMs = 2500,
): Promise<RescanServiceStatus> {
  const healthUrl = `${endpoint.replace(/\/rescan\/?$/, '')}/health`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    if (!response.ok) return { online: false, detail: `HTTP ${response.status}` };
    return { online: true };
  } catch (error) {
    return { online: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    window.clearTimeout(timer);
  }
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
  const actionPlan = result.actionPlan === undefined ? null : parseHomeSafetyActionPlan(result.actionPlan);
  if (result.actionPlan !== undefined && (!actionPlan || status !== 'ready')) {
    throw new Error('复扫服务返回了无效行动计划或尚未完成的关闭结果');
  }
  return {
    status: status as RescanJobStatus,
    jobId: typeof result.jobId === 'string' ? result.jobId : undefined,
    message: typeof result.message === 'string' ? result.message : undefined,
    latestRiskIds: Array.isArray(result.latestRiskIds)
      ? result.latestRiskIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    actionPlan: actionPlan ?? undefined,
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
