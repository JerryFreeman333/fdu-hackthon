export type CaptureSemanticStatus = 'unavailable' | 'pending' | 'processing' | 'ready' | 'failed';
export type CaptureModelStatus = 'missing' | 'building' | 'ready' | 'failed';

export interface CaptureHomeState {
  status: string;
  modelUrl?: string | null;
  modelReady?: boolean;
  semanticReady?: boolean;
  semanticStatus?: string;
  semanticMessage?: string;
  semanticUrl?: string | null;
  message?: string;
}

export interface CaptureReadiness {
  visible: boolean;
  model: CaptureModelStatus;
  semantic: CaptureSemanticStatus;
  canViewModel: boolean;
  canViewSemantic: boolean;
  modelText: string;
  semanticText: string;
}

const BUILDING = new Set(['uploading', 'queued', 'extracting', 'reconstructing', 'training']);

const MODEL_TEXT: Record<CaptureModelStatus, string> = {
  missing: '尚未生成。上传视频后才会开始建立。',
  building: '正在生成，可以离开页面稍后返回。',
  ready: '已生成。可查看房间外观，但模型本身不代表风险结论。',
  failed: '未生成或文件缺失，可检查后重新处理。',
};

const SEMANTIC_TEXT: Record<CaptureSemanticStatus, string> = {
  unavailable: '本次未执行视觉语义识别；系统不会显示猜测的物品位置。',
  pending: '房间外观模型生成后，会尝试识别物品与位置。',
  processing: '正在识别物品与位置；此时仍可查看房间外观。',
  ready: '已生成有画面和 3D 证据的物品位置；路线与风险仍需人工确认。',
  failed: '视觉语义识别未完成；系统不会显示猜测的物品位置。',
};

function modelStatus(home: CaptureHomeState): CaptureModelStatus {
  const hasModel = home.status === 'ready'
    && (home.modelReady === true || (home.modelReady === undefined && !!home.modelUrl))
    && !!home.modelUrl;
  if (hasModel) return 'ready';
  if (home.status === 'ready') return 'failed';
  if (home.status === 'failed') return 'failed';
  if (BUILDING.has(home.status)) return 'building';
  return 'missing';
}

function semanticStatus(home: CaptureHomeState, model: CaptureModelStatus): CaptureSemanticStatus {
  const hasSemantic = home.status === 'ready' && model === 'ready' && home.semanticReady === true && !!home.semanticUrl;
  if (hasSemantic) return 'ready';
  if (home.semanticStatus === 'ready') return 'failed';
  if (home.semanticStatus === 'processing') return 'processing';
  if (home.semanticStatus === 'failed') return 'failed';
  if (home.semanticStatus === 'unavailable') return 'unavailable';
  if (home.semanticStatus === 'pending' || home.semanticStatus === 'queued') return 'pending';
  if (home.status === 'failed') return 'failed';
  if (model === 'building') return 'pending';
  return 'unavailable';
}

export function captureReadiness(home: CaptureHomeState): CaptureReadiness {
  const model = modelStatus(home);
  const semantic = semanticStatus(home, model);
  return {
    visible: home.status !== 'empty',
    model,
    semantic,
    canViewModel: model === 'ready',
    canViewSemantic: model === 'ready' && semantic === 'ready',
    modelText: MODEL_TEXT[model],
    semanticText: home.semanticMessage?.trim() || SEMANTIC_TEXT[semantic],
  };
}
