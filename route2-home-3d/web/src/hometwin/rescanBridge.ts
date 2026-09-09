import { buildRescanManifest } from './rescanManifest';
import { prepareRescanFiles, type RescanInputResult } from './rescanInput';
import { submitRescanBatch } from './rescanClient';

export interface RescanBridgeResult {
  input: RescanInputResult;
  manifest: ReturnType<typeof buildRescanManifest>;
  response: Awaited<ReturnType<typeof submitRescanBatch>>;
}

export async function submitBrowserRescan(files: File[]): Promise<RescanBridgeResult | null> {
  const input = prepareRescanFiles(files);
  if (!input) return null;
  const manifest = buildRescanManifest(input.batch);
  const response = await submitRescanBatch(input.batch, files);
  return { input, manifest, response };
}
