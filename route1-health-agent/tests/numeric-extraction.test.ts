import { extractHealthValues } from '../src/engine/extract';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const nightWakesArabic = extractHealthValues('晚上起夜3次');
assert(nightWakesArabic.length === 1, 'Arabic-digit night wake count should be extracted');
assert(nightWakesArabic[0]?.metric === 'nightWakes', 'Arabic-digit extraction should map to nightWakes');
assert(nightWakesArabic[0]?.value === 3, '3次 should normalize to 3');

const stepsArabic = extractHealthValues('今天走了6000步');
assert(stepsArabic.length === 1, 'Arabic-digit step count should be extracted');
assert(stepsArabic[0]?.metric === 'steps', 'Arabic-digit extraction should map to steps');
assert(stepsArabic[0]?.value === 6000, '6000步 should normalize to 6000');

const rangeArabic = extractHealthValues('起夜3到5次');
assert(rangeArabic.length === 1, 'Arabic-digit range should be extracted');
assert(rangeArabic[0]?.metric === 'nightWakes', 'Arabic-digit range should map to nightWakes');
assert(rangeArabic[0]?.value === 4, '3到5次 should normalize to midpoint 4');

const nightWakesChinese = extractHealthValues('我昨晚起夜三四次');
assert(nightWakesChinese[0]?.value === 3.5, '三四次 should normalize to midpoint 3.5');

const stepsChinese = extractHealthValues('今天走了六千步');
assert(stepsChinese[0]?.value === 6000, '六千步 should normalize to 6000');

console.log('PASS: Arabic and Chinese numeric extraction regression suite');
