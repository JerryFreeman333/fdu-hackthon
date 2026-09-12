import { useCallback, useEffect, useMemo, useState } from 'react';
import { HomeTwinClient, type HomeTwinIntegration, type HomeTwinItemResult } from '../adapters/HomeTwinClient';

export type HomeTwinConnection =
  | { status: 'checking'; detail: string }
  | { status: 'connected'; detail: string; integration: HomeTwinIntegration }
  | { status: 'offline'; detail: string };

export function useHomeTwinIntegration(endpoint: string) {
  const client = useMemo(() => new HomeTwinClient(endpoint), [endpoint]);
  const [connection, setConnection] = useState<HomeTwinConnection>({ status: 'checking', detail: '正在连接家庭空间…' });

  const refresh = useCallback(async () => {
    setConnection({ status: 'checking', detail: '正在连接家庭空间…' });
    try {
      const integration = await client.integration();
      setConnection({
        status: 'connected',
        detail: integration.dataMode === 'real' ? '路线二真实 Home Twin 已连接' : '路线二已连接，当前使用演示空间数据',
        integration,
      });
      return integration;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConnection({ status: 'offline', detail: `路线二未连接：${message}` });
      return null;
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const findItem = useCallback(async (query: string): Promise<HomeTwinItemResult> => client.findItem(query), [client]);
  const updateAction = useCallback(
    async (actionId: string, status: 'open' | 'done') => client.updateAction(actionId, status),
    [client],
  );

  return { connection, refresh, findItem, updateAction };
}
