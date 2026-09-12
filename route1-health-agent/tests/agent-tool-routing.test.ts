import assert from 'node:assert/strict';
import test from 'node:test';
import { routeAgentToolIntent } from '../src/agent-tools/intentRouter';
import { AgentToolRegistry } from '../src/agent-tools/registry';
import type { AgentTool } from '../src/agent-tools/types';

void test('位置问题进入路线二，服药咨询仍留在路线一', () => {
  assert.deepEqual(routeAgentToolIntent('我的降压药放在哪里？'), {
    name: 'home.find_item',
    input: { query: '降压药' },
  });
  assert.deepEqual(routeAgentToolIntent('带我去找老花镜'), {
    name: 'home.find_item',
    input: { query: '老花镜' },
  });
  assert.equal(routeAgentToolIntent('降压药几点吃？'), null);
  assert.equal(routeAgentToolIntent('这个药能不能加量？'), null);
});

void test('Agent 工具必须显式注册后才能执行', async () => {
  const fake: AgentTool<{ query: string }> = {
    name: 'home.find_item',
    description: 'test',
    async execute(input) {
      return {
        ok: true,
        tool: 'home.find_item',
        message: `${input.query}在床头柜`,
        source: 'route2-home-twin',
        dataMode: 'demo',
      };
    },
  };
  const registry = new AgentToolRegistry().register(fake);
  const result = await registry.execute({ name: 'home.find_item', input: { query: '降压药' } });
  assert.equal(result.message, '降压药在床头柜');
  assert.deepEqual(registry.capabilities(), [{ name: 'home.find_item', description: 'test' }]);
});
