import { extractHealthValues } from '../src/engine/extract';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectOne(text: string, metric: 'nightWakes' | 'steps', value: number): void {
  const results = extractHealthValues(text);
  assert(results.length === 1, `${text} should produce exactly one extracted value`);
  assert(results[0]?.metric === metric, `${text} should map to ${metric}`);
  assert(results[0]?.value === value, `${text} should normalize to ${value}, got ${results[0]?.value}`);
}

expectOne('起夜3次', 'nightWakes', 3);
expectOne('起夜三次', 'nightWakes', 3);
expectOne('走了6000步', 'steps', 6000);
expectOne('今天走了6000步', 'steps', 6000);
expectOne('起夜 3 次', 'nightWakes', 3);
expectOne('走了 6000 步', 'steps', 6000);
expectOne('起夜3到4次', 'nightWakes', 3.5);
expectOne('走了6000-8000步', 'steps', 7000);
expectOne('起夜3.5次', 'nightWakes', 3.5);
expectOne('走了6000.5步', 'steps', 6000.5);

assert(extractHealthValues('今天睡得不错').length === 0, 'unrelated text should not create a numeric extraction');
assert(extractHealthValues('今天走了很多步').length === 0, 'non-numeric vague text should not create a step value');

function expectBp(text: string, systolic: number, diastolic: number): void {
  const values = extractHealthValues(text).filter((value) => value.unit === 'mmHg');
  assert(values.length === 2, `${text} should extract both BP values, got ${values.length}`);
  assert(
    values.find((value) => value.metric === 'systolic')?.value === systolic,
    `${text}: systolic should be ${systolic}`,
  );
  assert(
    values.find((value) => value.metric === 'diastolic')?.value === diastolic,
    `${text}: diastolic should be ${diastolic}`,
  );
}

function expectSingle(text: string, metric: 'restingHr' | 'weight', value: number): void {
  const results = extractHealthValues(text);
  assert(results.length === 1, `${text} should produce exactly one extracted value`);
  assert(results[0]?.metric === metric, `${text} should map to ${metric}`);
  assert(results[0]?.value === value, `${text} should normalize to ${value}, got ${results[0]?.value}`);
}

// 零位补零的中文数字：结尾数字是真实个位，不能按口语截断翻倍（“一百零五”≠150）。
expectBp('血压一百零五/六十八', 105, 68);
expectBp('血压一百零八/七十', 108, 70);
expectSingle('心率一百零五', 'restingHr', 105);
expectSingle('体重一百零五公斤', 'weight', 105);
expectOne('走了一千零五步', 'steps', 1005);

// 口语截断保持原语义：“一百二”=120、“一百五”=150、“一千五百”=1500。
expectBp('血压一百二/八十', 120, 80);
expectSingle('心率一百五', 'restingHr', 150);
expectOne('走了一千五百步', 'steps', 1500);

console.log('PASS: Arabic and Chinese numeral extraction regression suite');
