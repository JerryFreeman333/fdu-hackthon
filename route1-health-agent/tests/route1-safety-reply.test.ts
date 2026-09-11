/**
 * Route 1 \u5b89\u5168\u56de\u590d\u9632\u5fa1\u5c42\u589e\u5f3a\u6d4b\u8bd5\uff1a\u8986\u76d6\u6269\u5c55\u540e\u7684\u6240\u6709\u5371\u9669\u5339\u914d\u6a21\u5f0f\u3002
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeAgentReply } from '../src/engine/agent';

test('\u6761\u4ef6\u8bca\u65ad: \u201c\u60a8\u53ef\u80fd\u5fc3\u810f\u75c5\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u60a8\u53ef\u80fd\u5fc3\u810f\u75c5'), false);
});

test('\u6761\u4ef6\u8bca\u65ad: \u201c\u53ef\u80fd\u5f97\u4e86\u9ad8\u8840\u538b\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u53ef\u80fd\u5f97\u4e86\u9ad8\u8840\u538b'), false);
});

test('\u6761\u4ef6\u8bca\u65ad: \u201c\u770b\u8d77\u6765\u50cf\u5fc3\u8870\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u770b\u8d77\u6765\u50cf\u5fc3\u8870'), false);
});

test('\u6761\u4ef6\u8bca\u65ad: \u201c\u4f30\u8ba1\u662f\u80ba\u708e\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u4f30\u8ba1\u662f\u80ba\u708e'), false);
});

test('\u6761\u4ef6\u8bca\u65ad: \u201c\u9ad8\u5ea6\u6000\u7591\u4e2d\u98ce\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u9ad8\u5ea6\u6000\u7591\u4e2d\u98ce'), false);
});

test('\u6761\u4ef6\u8bca\u65ad: \u201c\u4e0d\u6392\u9664\u5fc3\u8870\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u4e0d\u6392\u9664\u5fc3\u8870'), false);
});

test('\u7edd\u5bf9\u8bca\u65ad: \u201c\u5c31\u662f\u5fc3\u810f\u75c5\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u5c31\u662f\u5fc3\u810f\u75c5'), false);
});

test('\u7edd\u5bf9\u8bca\u65ad: \u201c\u4e00\u5b9a\u662f\u764c\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u4e00\u5b9a\u662f\u764c'), false);
});

test('\u63a8\u65ad: \u201c\u63a8\u65ad\u662f\u80ba\u90e8\u611f\u67d3\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u63a8\u65ad\u662f\u80ba\u90e8\u611f\u67d3'), false);
});

test('\u63a8\u65ad: \u201c\u5e94\u8be5\u662f\u8111\u5352\u4e2d\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u5e94\u8be5\u662f\u8111\u5352\u4e2d'), false);
});

test('\u8bca\u65ad\u8bcd: \u201c\u60a8\u5f97\u4e86\u9ad8\u8840\u538b\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u60a8\u5f97\u4e86\u9ad8\u8840\u538b'), false);
});

test('\u81ea\u4e3b\u8c03\u836f: \u201c\u8bf7\u81ea\u5df1\u52a0\u91cf\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u8bf7\u81ea\u5df1\u52a0\u91cf'), false);
});

test('\u81ea\u4e3b\u8c03\u836f: \u201c\u6700\u597d\u505c\u836f\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u6700\u597d\u505c\u836f'), false);
});

test('\u81ea\u4e3b\u8c03\u836f: \u201c\u6362\u4e00\u79cd\u836f\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u6362\u4e00\u79cd\u836f'), false);
});

test('\u63a8\u8350\u836f\u7269: \u201c\u8bf7\u670d\u7528\u964d\u538b\u836f\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u8bf7\u670d\u7528\u964d\u538b\u836f'), false);
});

test('\u63a8\u8350\u836f\u7269: \u201c\u5efa\u8bae\u5403\u5b89\u7720\u836f\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u5efa\u8bae\u5403\u5b89\u7720\u836f'), false);
});

test('\u63a8\u8350\u68c0\u67e5: \u201c\u9700\u8981\u505a\u5fc3\u7535\u56fe\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u9700\u8981\u505a\u5fc3\u7535\u56fe'), false);
});

test('\u63a8\u8350\u68c0\u67e5: \u201c\u5efa\u8bae\u60a8\u68c0\u67e5\u4e00\u4e0b\u8840\u7cd6\u201d \u88ab\u62d2\u7edd', () => {
  assert.equal(isSafeAgentReply('\u5efa\u8bae\u60a8\u68c0\u67e5\u4e00\u4e0b\u8840\u7cd6'), false);
});

test('\u80fd\u653e\u8fc7\u7684: \u5e38\u89c4\u6e29\u67d4\u63d0\u793a', () => {
  assert.equal(isSafeAgentReply('\u5148\u5750\u4e0b\u6765\u4f11\u606f\uff0c\u4e0d\u8981\u6025\u3002'), true);
  assert.equal(isSafeAgentReply('\u6309\u8bbe\u5907\u8bf4\u660e\u590d\u6d4b\u4e00\u6b21\u3002'), true);
  assert.equal(isSafeAgentReply('\u5982\u679c\u4f34\u5934\u6655\u8bf7\u544a\u8bc9\u6211\u4eec\u3002'), true);
});

test('\u80fd\u653e\u8fc7\u7684: \u201c\u8bca\u65ad\u62a5\u544a\u201d \u5141\u8bb8\uff08\u4e0d\u662f\u8bca\u65ad\u672c\u8eab\uff09', () => {
  assert.equal(isSafeAgentReply('\u8bf7\u67e5\u770b\u4e0a\u6b21\u7684\u8bca\u65ad\u62a5\u544a'), true);
  assert.equal(isSafeAgentReply('\u8bf7\u67e5\u770b\u68c0\u9a8c\u62a5\u544a\u518d\u786e\u8ba4'), true);
});

test('\u80fd\u653e\u8fc7\u7684: \u88ab\u52a0\u91cf\u7684\u5fc3\u5fc3\u7ec6\u8282 \u4e0d\u4f1a\u88ab\u8bef\u6740', () => {
  // \u4ec5\u5305\u542b \u201c\u52a0\u91cf\u201d\u4e0d\u4f1a\u88ab\u62d2\u7edd (\u8be5\u53e5\u672c\u8eab\u4e0d\u662f\u8bca\u65ad)
  assert.equal(isSafeAgentReply('\u4eca\u5929\u8865\u4e86\u52a0\u91cf\u996d\u91cf'), true);
  assert.equal(isSafeAgentReply('\u8bb0\u5f97\u52a0\u91cf'), true);
});

test('\u7a7a\u6587\u8fd8\u662f\u4e0d\u5b89\u5168', () => {
  assert.equal(isSafeAgentReply(''), false);
  assert.equal(isSafeAgentReply('   '), false);
});

test('\u8d85\u957f\u8fd8\u662f\u4e0d\u5b89\u5168', () => {
  assert.equal(isSafeAgentReply('x'.repeat(600)), false);
});

// === Issue ⑪ regression: 检查名"做一下/个/检查一下"等绕过修复 ===
test('issue ⑪: “建议做一下冠脉造影” 被拒绝（被量词绕过的场景）', () => {
  assert.equal(isSafeAgentReply('建议做一下冠脉造影'), false);
  assert.equal(isSafeAgentReply('建议做个血常规'), false);
  assert.equal(isSafeAgentReply('建议做一个心电图'), false);
});

test('issue ⑪: “去做一下/个” 被拒绝', () => {
  assert.equal(isSafeAgentReply('建议去做一下头部CT'), false);
  assert.equal(isSafeAgentReply('建议去做个肺部CT'), false);
});

test('issue ⑪: “查一下/检查一下” 被拒绝', () => {
  assert.equal(isSafeAgentReply('建议查一下血常规'), false);
  assert.equal(isSafeAgentReply('建议检查一下心肌酶'), false);
});

test('issue ⑪: “最好去做个/跑一趟” 被拒绝', () => {
  assert.equal(isSafeAgentReply('最好去做个头部CT'), false);
  assert.equal(isSafeAgentReply('最好跑一趟心电图'), false);
});

test('issue ⑪: “您应该做一下” 被拒绝（您前缀作为语义起点）', () => {
  assert.equal(isSafeAgentReply('您应该做一下血常规'), false);
  assert.equal(isSafeAgentReply('您需要查一下心电图'), false);
  assert.equal(isSafeAgentReply('您最好检查一下心肌酶'), false);
});

test('issue ⑪: “肺部CT / 头部CT / 24小时心电图” 空格变异同样拒绝', () => {
  assert.equal(isSafeAgentReply('建议做一下肺部 CT'), false);
  assert.equal(isSafeAgentReply('建议做一下肺部CT'), false);
  assert.equal(isSafeAgentReply('建议做一下头部 CT'), false);
  assert.equal(isSafeAgentReply('建议做一下头部CT'), false);
  assert.equal(isSafeAgentReply('建议做一下 24 小时心电图'), false);
  assert.equal(isSafeAgentReply('建议做一下 24小时心电图'), false);
});

test('issue ⑪: 中性表达不被误拒', () => {
  // 不包含具体检查名的建议语句仍是安全的。
  assert.equal(isSafeAgentReply('建议多休息'), true);
  assert.equal(isSafeAgentReply('建议您多喝水'), true);
  assert.equal(isSafeAgentReply('建议看下医生'), true);
  assert.equal(isSafeAgentReply('建议做个检查'), true);
  assert.equal(isSafeAgentReply('我去做CT'), true);
});

test('issue ⑪: 原有拒绝还在拒（regression）', () => {
  assert.equal(isSafeAgentReply('建议做冠脉造影'), false);
  assert.equal(isSafeAgentReply('建议查一下血常规'), false);
  assert.equal(isSafeAgentReply('建议跑一趟心电图'), false);
});
