import type { HomeSafetyAction } from '../adapters/HomeSafetyActionAdapter';

/** Demo contract shaped like Route 2's person-home-action-plan.json. */
export const demoHomeSafetyActions: HomeSafetyAction[] = [
  {
    id: 'action-home-night-route-demo',
    riskId: 'person-home-night-route',
    kind: 'safety_check',
    title: '先处理床到卫生间路线',
    description: '夜间活动增加且夜间视力较差；当前路线存在已识别的地面障碍。',
    requiresRescan: true,
    closureRule: {
      type: 'risk-disappears-after-rescan',
      riskId: 'person-home-night-route',
    },
    status: 'open',
  },
  {
    id: 'action-home-cable-demo',
    riskId: 'person-home-cable',
    kind: 'safety_check',
    title: '移除或固定通行路线上的电缆',
    description: '当前行动能力需要支撑，路线中检测到电缆障碍。',
    requiresRescan: true,
    closureRule: {
      type: 'risk-disappears-after-rescan',
      riskId: 'person-home-cable',
    },
    status: 'open',
  },
];
