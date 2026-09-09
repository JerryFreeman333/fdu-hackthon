export type RiskLevel = 'high' | 'medium' | 'low';

export interface HazardItem {
  id: string;
  title: string;
  level: RiskLevel;
  location: string;
  risk: string;
  advice: string;
  demoPos: [number, number, number];
  realPos: [number, number, number] | null;
}

export interface PathItem {
  id: string;
  title: string;
  mode: 'day' | 'night';
  demoPoints: [number, number, number][];
  hazardIds: string[];
  realPoints: [number, number, number][] | null;
}

export interface ItemInfo {
  id: string;
  title: string;
  location: string;
  say: string;
  demoPos: [number, number, number];
  realPos: [number, number, number] | null;
}

export interface HazardData {
  meta: {
    note: string;
    levels: Record<RiskLevel, string>;
    datasetVersion?: number;
    capturedAt?: string;
    provenance?: 'demo' | 'manual' | 'vision';
    scaleConfidence?: number;
  };
  hazards: HazardItem[];
  paths: PathItem[];
  items: ItemInfo[];
}

/** 场景模式: demo = 合成演示场景, real = 高斯泼溅真实模型 */
export type SceneMode = 'demo' | 'real';