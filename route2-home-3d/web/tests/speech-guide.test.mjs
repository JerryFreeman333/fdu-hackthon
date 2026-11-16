import test from 'node:test';
import assert from 'node:assert/strict';
import { buildItemSpeech } from '../src/ui/speech.ts';

const item = {
  id: 'glasses',
  title: '老花镜',
  location: '客厅电视柜第二层',
  say: '请慢慢走过去，不要着急。',
  demoPos: [0, 0, 0],
  realPos: null,
};

test('找东西的语音稿只朗读界面已展示的标题、位置和提示', () => {
  const text = buildItemSpeech(item);
  assert.ok(text.includes(item.title));
  assert.ok(text.includes(item.location));
  assert.ok(text.includes(item.say));
});

test('语音稿不生成额外位置或医疗建议', () => {
  const text = buildItemSpeech(item);
  assert.equal(text, `找到${item.title}。${item.location}。${item.say}`);
});
