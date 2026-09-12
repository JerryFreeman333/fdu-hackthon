import { parseHomeSafetyActions, type HomeSafetyAction } from './HomeSafetyActionAdapter';

export type HomeTwinDataMode = 'real' | 'demo' | 'unknown';

export interface HomeTwinItemResult {
  status: 'found' | 'not_found';
  dataMode: HomeTwinDataMode;
  message: string;
  item?: { id: string; title: string; location: string; say?: string } | null;
}

export interface HomeTwinIntegration {
  status: 'ready';
  dataMode: HomeTwinDataMode;
  capturedAt?: string | null;
  actions: HomeSafetyAction[];
  itemCount: number;
}

function request(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(4500) });
}

export class HomeTwinClient {
  constructor(private readonly endpoint: string) {}

  private url(path: string): string {
    return `${this.endpoint.replace(/\/$/, '')}${path}`;
  }

  async integration(): Promise<HomeTwinIntegration> {
    const response = await request(this.url('/api/route2/integration'));
    if (!response.ok) throw new Error(`Home Twin 返回 ${response.status}`);
    const payload = (await response.json()) as Record<string, unknown>;
    if (payload.status !== 'ready') throw new Error('Home Twin 尚未准备好');
    const actions = parseHomeSafetyActions({ actions: payload.actions });
    return {
      status: 'ready',
      dataMode: payload.dataMode === 'real' || payload.dataMode === 'demo' ? payload.dataMode : 'unknown',
      capturedAt: typeof payload.capturedAt === 'string' ? payload.capturedAt : null,
      actions,
      itemCount: Array.isArray(payload.items) ? payload.items.length : 0,
    };
  }

  async findItem(query: string): Promise<HomeTwinItemResult> {
    const response = await request(this.url(`/api/route2/items/find?q=${encodeURIComponent(query)}`));
    if (!response.ok) throw new Error(`家庭物品查询返回 ${response.status}`);
    return (await response.json()) as HomeTwinItemResult;
  }

  async updateAction(actionId: string, status: 'open' | 'done'): Promise<void> {
    const response = await request(
      this.url(`/api/route2/actions/${encodeURIComponent(actionId)}/status?status=${status}`),
      { method: 'POST' },
    );
    if (!response.ok) throw new Error(`家庭行动同步返回 ${response.status}`);
  }
}
