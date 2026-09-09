import { parseElderInput, createHttpLlmAdapter, parseExternalLlmPayload } from '../src/engine/agent';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runCase(name: string, test: () => void) {
  test();
  console.log(`PASS: ${name}`);
}

runCase('允许的 SymptomTag 通过运行时白名单', () => {
  const parsed = parseExternalLlmPayload({ text: '请先坐下休息。', tags: ['dizziness', 'fall'] });
  assert(parsed?.text === '请先坐下休息。', '应保留合法文本');
  assert(parsed?.tags.join('|') === 'dizziness|fall', '应保留合法标签');
});

runCase('未知 tag 必须被拒绝，不能靠 TypeScript cast 混过去', () => {
  assert(parseExternalLlmPayload({ text: '正常回复', tags: ['internal_admin_flag'] }) === null, '未知 tag 应被拒绝');
});

runCase('tags 非数组必须被拒绝', () => {
  assert(parseExternalLlmPayload({ text: '正常回复', tags: 'fall' }) === null, 'tags 字段类型错误应被拒绝');
});

runCase('text 非字符串必须被拒绝', () => {
  assert(parseExternalLlmPayload({ text: { unsafe: true }, tags: ['fall'] }) === null, 'text 类型错误应被拒绝');
});

runCase('缺少可选 tags 时使用本地确定性标签，不信任模型补标签', () => {
  const parsed = parseExternalLlmPayload({ text: '请先坐下休息。' });
  assert(parsed?.text === '请先坐下休息。', '应保留合法文本');
  assert(parsed?.tags.length === 0, '缺少 tags 时不应伪造或猜测标签');
});

runCase('缺少 text 时 payload 仍可解析为无文本结果，由上层安全回退处理', () => {
  const parsed = parseExternalLlmPayload({ tags: ['fall'] });
  assert(parsed?.text === '', '缺少 text 时应得到空字符串');
  assert(parsed?.tags[0] === 'fall', '合法 tags 可以保留');
});

runCase('外部模型返回的标签不能改变本地规则识别结果', () => {
  const local = parseElderInput('刚才摔了一跤');
  const malicious = parseExternalLlmPayload({ text: '你应该立即停药。', tags: ['medicationMissed'] });
  assert(local.tags.includes('fall'), '本地规则仍应识别跌倒');
  assert(malicious?.tags.includes('medicationMissed'), '测试负载本身可以合法解析');
  assert(!local.tags.includes('medicationMissed'), '外部标签不能注入本地确定性识别结果');
});

runCase('外部 API endpoint 仍受既有来源限制', () => {
  let rejected = false;
  try {
    createHttpLlmAdapter('http://attacker.example.com/llm');
  } catch {
    rejected = true;
  }
  assert(rejected, '非 HTTPS/同源/localhost endpoint 应被拒绝');
});
