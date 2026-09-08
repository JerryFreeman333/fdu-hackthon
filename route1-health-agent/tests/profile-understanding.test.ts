import assert from 'node:assert/strict';
import { emptyProfile, validateProfile } from '../src/engine/profile';
import { parseProfileUnderstanding } from '../src/engine/profileUnderstanding';
import { nextProfileQuestion } from '../src/engine/profileInterview';
import { createHttpLlmAdapter } from '../src/engine/agent';

const userText = '叫我王姨，今年七十二岁，没有高血压，有糖尿病，平时自己走';
const result = parseProfileUnderstanding(
  {
    reply: '请确认一下。',
    updates: [
      { field: 'name', answer: '王姨', source: '叫我王姨' },
      { field: 'age', answer: '72', source: '七十二岁' },
      { field: 'conditions', answer: '糖尿病', source: '没有高血压，有糖尿病' },
      { field: 'mobility', answer: '自己能走', source: '自己走' },
    ],
  },
  emptyProfile,
  userText,
);
assert.equal(emptyProfile.name, '', 'extraction must not mutate saved profile before confirmation');
assert.deepEqual(result.fields, [0, 1, 2, 4]);
const saved = validateProfile(JSON.parse(JSON.stringify(result.profile)));
assert.equal(saved.name, '王姨');
assert.equal(saved.age, 72);
assert.deepEqual(saved.conditions, ['糖尿病']);
assert.equal(saved.mobility, 'independent');
assert.equal(nextProfileQuestion(saved), 3, 'skip fields supplied out of order');
const correction = parseProfileUnderstanding(
  { reply: '请确认年龄。', updates: [{ field: 'age', answer: '73', source: '七十三' }] },
  saved,
  '刚才说错了，是七十三',
);
assert.equal(correction.profile.age, 73);
assert.equal(saved.age, 72, 'corrections also wait for confirmation');
assert.deepEqual(
  parseProfileUnderstanding({ reply: '这是为了了解您的日常情况，可以以后再补。', updates: [] }, saved, '为什么要问这些')
    .fields,
  [],
);
for (const update of [
  { field: 'familySharing', answer: 'granted', source: '同意' },
  { field: 'age', answer: '200', source: '同意' },
  { field: 'name', answer: '凭空捏造', source: '没有说过' },
])
  assert.throws(() => parseProfileUnderstanding({ reply: '收到。', updates: [update] }, emptyProfile, '同意'));

async function historyPrivacy() {
  const original = globalThis.fetch;
  let body = '';
  globalThis.fetch = (async (_url, options) => {
    body = String(options?.body);
    return new Response(JSON.stringify({ text: '您好' }));
  }) as typeof fetch;
  try {
    await createHttpLlmAdapter('/api/agent', [
      { id: '1', role: 'elder', text: '喜欢散步', time: '' },
      { id: '2', role: 'agent', text: '喜欢在哪里散步？', time: '' },
      { id: '3', role: 'elder', text: '这件事不要记录', time: '', persisted: false },
      { id: '4', role: 'agent', text: '隐私回答', time: '', persisted: false },
    ]).complete('简短回复', '你好');
    assert.ok(body.includes('喜欢散步'));
    assert.ok(!body.includes('隐私回答'));
    assert.ok(!body.includes('不要记录'));
  } finally {
    globalThis.fetch = original;
  }
}
void historyPrivacy();
