import type { HomeSafetyAction } from '../adapters/HomeSafetyActionAdapter';

/** Demo contract shaped like Route 2's person-home-action-plan.json. */
export const demoHomeSafetyActions: HomeSafetyAction[] = [
  {
    id: 'action-home-night-route-demo',
    riskId: 'person-home-night-route',
    kind: 'safety_check',
    title: '先处理床到卫生间路线',
    description: '夜间活动增加且夜间视力较差；当前路线存在已识别的地面障碍。',
    action: '检查并固定或移除床到卫生间路线上的地毯/门槛，并补足夜间照明。',
    requiresRescan: true,
    closureRule: {
      type: 'risk-disappears-after-rescan',
      riskId: 'person-home-night-route',
    },
    status: 'open',
    source: 'route2-person-home-risk',
  },
  {
    id: 'action-home-cable-demo',
    riskId: 'person-home-cable',
    kind: 'observation',
    title: '移除或固定通行路线上的电缆',
    description: '当前行动能力需要支撑，路线中检测到电缆障碍。',
    action: '将电缆移出主要通行区域或固定到墙边，再重新扫描。',
    requiresRescan: true,
    closureRule: {
      type: 'risk-disappears-after-rescan',
      riskId: 'person-home-cable',
    },
    status: 'open',
    source: 'route2-person-home-risk',
  },
];
