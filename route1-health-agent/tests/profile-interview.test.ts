import assert from 'node:assert/strict';
import { emptyProfile, validateProfile } from '../src/engine/profile';
import { answerProfileQuestion, nextProfileQuestion, profileAnswer } from '../src/engine/profileInterview';

let profile = emptyProfile;
const answers = [
  '叫我李阿姨',
  '我今年七十二岁',
  '没有高血压，有糖尿病',
  '去年骨折，已恢复',
  '不需要拐杖',
  '看不清楚',
  '两次',
  '没有吃药',
];
answers.forEach((answer, index) => {
  assert.equal(nextProfileQuestion(profile), index);
  profile = answerProfileQuestion(profile, index, answer);
  // Each accepted answer survives the same serialization/validation used on reload.
  profile = validateProfile(JSON.parse(JSON.stringify(profile)));
  assert.equal(profileAnswer(profile, index), index === 0 ? '李阿姨' : answer);
});
assert.equal(nextProfileQuestion(profile), 8);
assert.equal(profile.name, '李阿姨');
assert.equal(profile.age, 72);
assert.equal(profile.usesCane, false);
assert.equal(profile.nightVision, 'reduced');
assert.equal(profile.usualNightWakes, 2);
assert.deepEqual(profile.conditions, ['没有高血压，有糖尿病']);
assert.throws(() => answerProfileQuestion(profile, 1, '七十二或者七十三'));
assert.throws(() => answerProfileQuestion(profile, 1, '七十二三'));
assert.throws(() => answerProfileQuestion(profile, 4, '有时用有时不用拐杖'));
assert.throws(() => answerProfileQuestion(profile, 1, '0'));
assert.throws(() => answerProfileQuestion(profile, 6, '31'));
const unknown = answerProfileQuestion(emptyProfile, 1, '不想回答');
assert.equal(unknown.age, null);
assert.equal(profileAnswer(unknown, 1), '不想回答');
assert.equal(nextProfileQuestion(validateProfile({ ...emptyProfile, name: '已有称呼' })), 1);
assert.equal(
  answerProfileQuestion({ ...profile, profileInterviewComplete: true }, 0, '李奶奶').profileInterviewComplete,
  true,
);
