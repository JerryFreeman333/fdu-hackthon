import type { RescanInputBatch } from './rescanInput';

export interface RescanSubmitResponse {
  status: 'queued' | 'processing' | 'ready' | 'failed';
  jobId?: string;
  message?: string;
  latestRiskIds?: string[];
  actionPlan?: unknown;
}

export interface RescanUploadOptions {
  endpoint?: string;
  signal?: AbortSignal;
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

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Keep the HTTP error below useful when a local endpoint is absent.
  }

  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as { message?: unknown }).message)
      : `HTTP ${response.status}`;
    throw new Error(`复扫上传失败: ${detail}`);
  }

  if (!payload || typeof payload !== 'object') {
    return { status: 'processing', message: '复扫已提交，等待 Home Twin 处理。' };
  }

  const result = payload as Record<string, unknown>;
  const status = result.status;
  if (!['queued', 'processing', 'ready', 'failed'].includes(String(status))) {
    throw new Error('复扫服务返回了无效状态');
  }
  return {
    status: status as RescanSubmitResponse['status'],
    jobId: typeof result.jobId === 'string' ? result.jobId : undefined,
    message: typeof result.message === 'string' ? result.message : undefined,
    latestRiskIds: Array.isArray(result.latestRiskIds)
      ? result.latestRiskIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    actionPlan: result.actionPlan,
  };
}
