import type { RescanInputBatch } from './rescanInput';

export interface RescanManifest {
  schemaVersion: 1;
  type: 'home-twin-rescan-manifest';
  batch: RescanInputBatch;
  source: 'browser-upload';
  createdAt: string;
  privacy: {
    rawMediaRetainedByBrowser: false;
    note: string;
  };
}

export function buildRescanManifest(batch: RescanInputBatch): RescanManifest {
  return {
    schemaVersion: 1,
    type: 'home-twin-rescan-manifest',
    batch,
    source: 'browser-upload',
    createdAt: new Date().toISOString(),
    privacy: {
      rawMediaRetainedByBrowser: false,
      note: '原始复扫媒体只通过明确的上传动作提交给后端/本地 Home Twin 管线；浏览器不把媒体写入 Home Twin JSON。',
    },
  };
}
