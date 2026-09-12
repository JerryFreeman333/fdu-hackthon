import { HomeTwinClient } from '../adapters/HomeTwinClient';
import type { AgentTool, AgentToolResult, FindHomeItemInput } from './types';

function residentTarget(homeTwinUrl: string, itemId?: string, demo = false): string {
  const url = new URL(homeTwinUrl);
  url.searchParams.set('role', 'resident');
  if (itemId) url.searchParams.set('find', itemId);
  if (demo) url.searchParams.set('demo', '1');
  return url.toString();
}

export class HomeTwinFindItemTool implements AgentTool<FindHomeItemInput> {
  readonly name = 'home.find_item' as const;
  readonly description = '在路线二 Home Twin 中查询药品或常用物品的最后确认位置';

  constructor(
    private readonly client: HomeTwinClient,
    private readonly homeTwinUrl: string,
  ) {}

  async execute(input: FindHomeItemInput): Promise<AgentToolResult> {
    try {
      const result = await this.client.findItem(input.query);
      if (result.status !== 'found' || !result.item) {
        return {
          ok: false,
          tool: this.name,
          message: result.message || '家庭空间里没有可靠的位置记录，我不会猜测。',
          source: 'route2-home-twin',
          dataMode: result.dataMode,
        };
      }
      const sourceLabel = result.dataMode === 'real' ? '真实家庭空间记录' : '演示家庭空间数据';
      return {
        ok: true,
        tool: this.name,
        message: `${result.message}\n数据来源：${sourceLabel}。`,
        source: 'route2-home-twin',
        dataMode: result.dataMode,
        target: {
          url: residentTarget(this.homeTwinUrl, result.item.id, result.dataMode === 'demo'),
          label: '在家庭空间中查看位置',
        },
      };
    } catch (error) {
      return {
        ok: false,
        tool: this.name,
        message: `家庭空间查询失败：${error instanceof Error ? error.message : String(error)}。我不会猜测位置。`,
        source: 'route2-home-twin',
        dataMode: 'unknown',
      };
    }
  }
}
