/**
 * P0 门控回归：personal（真实档案）模式下，演示数据绝不能混进真实数据链路。
 *
 * 背景（评审现场实测）：personal 模式拍照 → DemoImageHealthParser 返回硬编码
 * 148/88 → 确认后写入真实档案 → 触发 bpHigh 检测并可能通知家属。
 * 修复：没有真实视觉服务时，personal 模式的拍照识别必须被拒绝并如实说明。
 * （居家安全演示行动的 dataMode 门控在 App 层，由浏览器黑盒回归覆盖。）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoPhotoRefusal } from '../src/adapters/parserSelector';

void test('personal + demo parser → 拒绝并说明原因与替代路径', () => {
  const refusal = demoPhotoRefusal('personal', 'demo');
  assert.ok(refusal, 'personal 模式下演示识别必须被拒绝');
  assert.match(refusal, /不会写入任何数据/, '必须明确说明不会写入数据');
  assert.match(refusal, /对话里告诉我/, '必须给出可用的替代路径（对话口述数值）');
  assert.doesNotMatch(refusal, /示例识别完成/, '不得再以"识别完成"的口吻出现');
});

void test('personal + 真实视觉服务 → 放行', () => {
  assert.equal(demoPhotoRefusal('personal', 'real-http'), null);
});

void test('demo 模式 + demo parser → 放行（演示数据只进演示档案，不受影响）', () => {
  assert.equal(demoPhotoRefusal('demo', 'demo'), null);
});
