import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';

const TODAY = '2026-09-10';

// Final CI verification marker: final push gate from verified semantic/BP fix set.
function claimsOf(text: string) {
  return understandElderInput(text, TODAY).claims;
}