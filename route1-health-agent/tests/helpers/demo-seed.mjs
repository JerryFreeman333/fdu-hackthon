/**
 * 浏览器黑盒共用辅助：把"演示档案"种子进 localStorage。
 * 首启二选一上线后，无档案的全新 context 会停在 FirstRunGate；
 * 既有黑盒用例需要进入主界面，统一用本助手注入演示档案跳过首启。
 */
export const PROFILE_STORAGE_KEY = 'ankang-route1-profile-v1';

export const DEMO_PROFILE_SEED = {
  version: 1,
  dataMode: 'demo',
  profile: {
    name: '王秀兰奶奶',
    age: 72,
    conditions: ['高血压（已控制）', '心功能减退（随访中）'],
    medications: ['氨氯地平 5mg 每日一次', '美托洛尔 23.75mg 每日一次'],
    familyContact: '女儿 李芳 138****6677',
    familyPhone: '13800006677',
    communityDoctorPhone: '021-55661234',
    mobility: 'uses_cane',
    usesCane: true,
    nightVision: 'reduced',
    cognition: 'stable',
    familySharing: 'ask',
  },
};

/** 在应用脚本运行前把演示档案写入 localStorage，使页面直接进入主界面。 */
export function seedDemoProfile(page) {
  return page.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
    [PROFILE_STORAGE_KEY, JSON.stringify(DEMO_PROFILE_SEED)],
  );
}
