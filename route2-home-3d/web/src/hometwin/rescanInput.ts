export type RescanMediaKind = 'image' | 'video';

export interface RescanInputBatch {
  id: string;
  capturedAt: string;
  kind: RescanMediaKind;
  files: Array<{
    name: string;
    size: number;
    type: string;
    lastModified: number;
  }>;
  status: 'selected' | 'ready' | 'submitted';
}

export interface RescanInputResult {
  batch: RescanInputBatch;
  objectUrl?: string;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']);

function classify(file: File): RescanMediaKind | null {
  if (IMAGE_TYPES.has(file.type) || file.type.startsWith('image/')) return 'image';
  if (VIDEO_TYPES.has(file.type) || file.type.startsWith('video/')) return 'video';
  return null;
}

export function prepareRescanFiles(files: FileList | File[]): RescanInputResult | null {
  const selected = Array.from(files).filter((file) => classify(file) !== null);
  if (!selected.length) return null;

  const kinds = new Set(selected.map((file) => classify(file)));
  const kind: RescanMediaKind = kinds.has('video') ? 'video' : 'image';
  const batch: RescanInputBatch = {
    id: `rescan-${Date.now()}`,
    capturedAt: new Date().toISOString(),
    kind,
    files: selected.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    })),
    status: 'selected',
  };

  const objectUrl = selected.length === 1 ? URL.createObjectURL(selected[0]) : undefined;
  return { batch, objectUrl };
}

export function revokeRescanPreview(result: RescanInputResult | null): void {
  if (result?.objectUrl) URL.revokeObjectURL(result.objectUrl);
}
