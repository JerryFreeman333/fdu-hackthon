import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ICE_SERVERS, parseIceServers, parseSignalingUrl } from '../src/adapters/signalingConfig';

test('parseSignalingUrl：标准自建信令地址', () => {
  assert.deepEqual(parseSignalingUrl('wss://signal.example.cn:9000/peerjs'), {
    host: 'signal.example.cn',
    port: 9000,
    path: '/peerjs',
    secure: true,
  });
  assert.deepEqual(parseSignalingUrl('https://signal.example.cn'), {
    host: 'signal.example.cn',
    port: 443,
    path: '/',
    secure: true,
  });
  assert.deepEqual(parseSignalingUrl('http://192.168.1.10:9000'), {
    host: '192.168.1.10',
    port: 9000,
    path: '/',
    secure: false,
  });
});

test('parseSignalingUrl：非法输入一律返回 null（回退官方公共信令）', () => {
  assert.equal(parseSignalingUrl(''), null);
  assert.equal(parseSignalingUrl('   '), null);
  assert.equal(parseSignalingUrl('not-a-url'), null);
  assert.equal(parseSignalingUrl('ftp://signal.example.cn'), null);
  assert.equal(parseSignalingUrl('wss://host:notaport'), null);
});

test('parseIceServers：JSON 数组生效，非法输入返回 null', () => {
  assert.deepEqual(parseIceServers('[{"urls":"turn:turn.cn:3478","username":"u","credential":"p"}]'), [
    { urls: 'turn:turn.cn:3478', username: 'u', credential: 'p' },
  ]);
  assert.equal(parseIceServers(undefined), null);
  assert.equal(parseIceServers(''), null);
  assert.equal(parseIceServers('not json'), null);
  assert.equal(parseIceServers('[]'), null);
  assert.equal(parseIceServers('{}'), null);
});

test('默认 ICE 列表同时包含 Google 与国内可达的腾讯 STUN', () => {
  const urls = DEFAULT_ICE_SERVERS.map((server) => server.urls).join(',');
  assert.ok(urls.includes('stun.qq.com'), '必须包含国内可达 STUN');
  assert.ok(urls.includes('stun.l.google.com'), '保留 Google STUN 作为海外兜底');
});
