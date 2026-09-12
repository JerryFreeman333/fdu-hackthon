import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWebhookUrl, sendWebhookPush, type WebhookPushConfig } from '../src/adapters/WebhookPushChannel';
import { describeDeliveries, type FamilyNotificationRecord } from '../src/engine/notify';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

void test('resolveWebhookUrl：按服务商解析，非法配置返回 null', () => {
  assert.equal(resolveWebhookUrl({ provider: 'serverchan', token: 'SCT123' }), 'https://sctapi.ftqq.com/SCT123.send');
  assert.equal(resolveWebhookUrl({ provider: 'serverchan', token: '' }), null);
  assert.equal(resolveWebhookUrl({ provider: 'pushplus', token: 'whatever' }), 'https://www.pushplus.plus/send');
  assert.equal(
    resolveWebhookUrl({ provider: 'custom', token: 'x', customUrl: 'https://a.b/push' }),
    'https://a.b/push',
  );
  assert.equal(
    resolveWebhookUrl({ provider: 'custom', token: 'x', customUrl: 'http://a.b/push' }),
    null,
    '明文外网地址不允许',
  );
  assert.equal(
    resolveWebhookUrl({ provider: 'custom', token: 'x', customUrl: 'http://localhost:9000/push' }),
    'http://localhost:9000/push',
  );
});

void test('sendWebhookPush：Server酱 code=0 → sent，form-encoded 携带 title/desp', async () => {
  let capturedBody = '';
  const config: WebhookPushConfig = { provider: 'serverchan', token: 'SCTKEY' };
  const outcome = await sendWebhookPush(config, { title: '标题', body: '正文' }, async (_url, init) => {
    capturedBody = String(init?.body ?? '');
    return jsonResponse(200, { code: 0, message: '' });
  });
  assert.equal(outcome.status, 'sent');
  assert.match(outcome.detail, /Server酱/);
  assert.match(capturedBody, /title=%E6%A0%87%E9%A2%98/);
  assert.match(capturedBody, /desp=/);
});

void test('sendWebhookPush：Server酱业务错误 → failed 且带原因，绝不假装送达', async () => {
  const outcome = await sendWebhookPush({ provider: 'serverchan', token: 'BAD' }, { title: 't', body: 'b' }, async () =>
    jsonResponse(200, { code: 40001, message: 'invalid key' }),
  );
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.detail, /invalid key/);
});

void test('sendWebhookPush：PushPlus code=200 → sent', async () => {
  const outcome = await sendWebhookPush(
    { provider: 'pushplus', token: 'TOKEN' },
    { title: 't', body: 'b' },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      assert.equal(body.token, 'TOKEN');
      assert.equal(body.template, 'txt');
      return jsonResponse(200, { code: 200, msg: 'ok' });
    },
  );
  assert.equal(outcome.status, 'sent');
});

void test('sendWebhookPush：网络异常/超时 → failed；配置缺失 → unavailable', async () => {
  const networkFail = await sendWebhookPush(
    { provider: 'serverchan', token: 'SCT' },
    { title: 't', body: 'b' },
    async () => {
      throw new Error('ECONNREFUSED');
    },
  );
  assert.equal(networkFail.status, 'failed');
  assert.match(networkFail.detail, /ECONNREFUSED/);

  const unavailable = await sendWebhookPush({ provider: 'custom', token: 'x' }, { title: 't', body: 'b' }, async () =>
    jsonResponse(200, {}),
  );
  assert.equal(unavailable.status, 'unavailable');
});

void test('describeDeliveries：台账包含微信推送渠道标签', () => {
  const record: FamilyNotificationRecord = {
    findingId: 'f1',
    severity: 'urgent',
    title: 't',
    message: 'm',
    reason: 'r',
    createdAt: '2026-09-12T10:00:00.000Z',
    deliveries: [
      { channel: 'in_app', status: 'sent', detail: '已进入家属端通知中心', at: 'x' },
      { channel: 'browser_push', status: 'sent', detail: '已推送', at: 'x' },
      { channel: 'webhook_push', status: 'sent', detail: '已通过 Server酱 推送到微信', at: 'x' },
    ],
    lifecycle: 'new',
  };
  const text = describeDeliveries(record);
  assert.match(text, /系统通知已送达/);
  assert.match(text, /微信推送已送达/);
});
