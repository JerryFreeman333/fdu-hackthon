import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';

const TODAY = '2026-09-10';

test('ambiguous coordinated blood-pressure readings fail closed', () => {
  const text = '我和我爸都量了血压，一个180/110，一个150/90';
  const input = understandElderInput(text, TODAY);

  assert.equal(acceptedSelfClaims(input).length, 0, '两组未分配归属的血压不能进入本人事实流');
  assert.ok(
    input.claims.some((claim) => claim.subject === 'unknown'),
    '读数归属不明应进入 unknown',
  );
  assert.ok(input.clarificationQuestion?.includes('多个健康读数'), '应明确提示多个读数需要分别说明归属');
});

test('single shared coordinated blood-pressure reading keeps existing behavior', () => {
  const text = '我和我爸都量了血压180/110';
  const input = understandElderInput(text, TODAY);
  const selfClaims = acceptedSelfClaims(input);

  assert.equal(selfClaims.length, 1, '单一明确共享读数仍保持原有本人记录行为');
  assert.equal(input.claims.filter((claim) => claim.subject === 'father').length, 1, '家属事实仍保留');
});
