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

console.log('PASS: Arabic and Chinese numeral extraction regression suite');
