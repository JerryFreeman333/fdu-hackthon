import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateAgentReply, ruleBasedAdapter } from '../src/engine/agent';

void test('private and no-record prompts stay on the local safety adapter path', async () => {
  const privateReply = await generateAgentReply(
    '这个不要告诉孩子，我胸口现在很痛',
    ['chestPain'],
    [],
    true,
    undefined,
    ruleBasedAdapter,
  );
  assert.match(privateReply, /胸痛|停止活动/);

  const noRecordReply = await generateAgentReply(
    '这个不要记录，我刚才摔了一跤',
    ['fall'],
    [],
    true,
    undefined,
    ruleBasedAdapter,
  );
  assert.ok(noRecordReply.length > 0);
});
