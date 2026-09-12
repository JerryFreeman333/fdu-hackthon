import test from 'node:test';
import assert from 'node:assert/strict';
import { demoStoredProfile, emptyProfile, isValidStoredProfile, loadStoredProfile } from '../src/store/profileStore';

const STORAGE_KEY = 'ankang-route1-profile-v1';

function installMemoryStorage(initial: unknown): void {
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (key === STORAGE_KEY ? JSON.stringify(initial) : null),
      setItem: () => {},
      removeItem: () => {},
    },
  };
}

function removeWindow(): void {
  delete (globalThis as { window?: unknown }).window;
}

void test('demoStoredProfile 是可直接使用的演示档案', () => {
  const stored = demoStoredProfile();
  assert.equal(stored.version, 1);
  assert.equal(stored.dataMode, 'demo');
  assert.ok(stored.profile.name.length > 0);
  assert.ok(stored.profile.familyPhone.length > 0);
});

void test('emptyProfile：建档起点除了默认授权偏好外全部留白', () => {
  const profile = emptyProfile();
  assert.equal(profile.name, '');
  assert.deepEqual(profile.medications, []);
  assert.equal(profile.familyPhone, '');
  assert.equal(profile.familySharing, 'ask');
});

void test('isValidStoredProfile：坏数据/旧版本一律视为没有档案', () => {
  assert.equal(isValidStoredProfile(null), false);
  assert.equal(isValidStoredProfile({ version: 2 }), false);
  assert.equal(isValidStoredProfile({ version: 1, profile: { name: '' } }), false);
  assert.equal(isValidStoredProfile({ version: 1, profile: { name: '李奶奶' }, dataMode: 'personal' }), true);
});

void test('loadStoredProfile：无 window 环境（SSR/测试）安全返回 null，坏 JSON 也不抛错', () => {
  removeWindow();
  assert.equal(loadStoredProfile(), null);

  installMemoryStorage({ broken: true });
  assert.equal(loadStoredProfile(), null);
  removeWindow();
});

void test('loadStoredProfile：合法档案按 dataMode 读取', () => {
  installMemoryStorage({ version: 1, profile: { name: '李奶奶' }, dataMode: 'personal' });
  const stored = loadStoredProfile();
  assert.equal(stored?.dataMode, 'personal');
  assert.equal(stored?.profile.name, '李奶奶');
  removeWindow();
});
