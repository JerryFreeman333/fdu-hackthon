import { strict as assert } from 'node:assert';
import { extractHealthValues } from '../src/engine/extract';

const nightWakesArabic = extractHealthValues('晚上起夜3次');
assert.equal(nightWakesArabic.length, 1);
assert.equal(nightWakesArabic[0]?.metric, 'nightWakes');
assert.equal(nightWakesArabic[0]?.value, 3);

const stepsArabic = extractHealthValues('今天走了6000步');
assert.equal(stepsArabic.length, 1);
assert.equal(stepsArabic[0]?.metric, 'steps');
assert.equal(stepsArabic[0]?.value, 6000);

const rangeArabic = extractHealthValues('起夜3到5次');
assert.equal(rangeArabic.length, 1);
assert.equal(rangeArabic[0]?.metric, 'nightWakes');
assert.equal(rangeArabic[0]?.value, 4);

const nightWakesChinese = extractHealthValues('我昨晚起夜三四次');
assert.equal(nightWakesChinese[0]?.value, 3.5);

const stepsChinese = extractHealthValues('今天走了六千步');
assert.equal(stepsChinese[0]?.value, 6000);

console.log('PASS: Arabic and Chinese numeric extraction regression suite');
