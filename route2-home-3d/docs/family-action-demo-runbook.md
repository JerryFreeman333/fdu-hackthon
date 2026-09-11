# Route 2 家庭行动闭环演示手册

## 浏览器 Demo

进入 `route2-home-3d/web` 后运行：

```bash
npm ci
npm run dev
```

页面右侧新增“家庭行动”页签。

## 演示脚本

1. 打开“安全巡检”，点击“地毯翘边”，展示它位于夜间起夜路径附近。
2. 打开“动线分析”，选择“夜间起夜动线（床 → 卫生间）”，展示地毯、门槛、照明和卫生间入口共同形成的空间上下文。
3. 打开“家庭行动”，展示由 Person × Home 风险生成的两项家庭任务。
4. 现场口述：家属已经处理地毯，因此点击“🔄 已处理？重新扫描确认”。
5. Demo 载入 `public/data/family-action-rescan.json`，其中 `person-home-surface` 已消失，但 `person-home-night-route` 仍存在。
6. 页面因此把“处理地面障碍”标记为“已通过复扫”，同时保留“复核夜间通行路线”。

## 真实环境

真实环境不应读取 Demo rescan fixture。应运行：

```powershell
powershell -ExecutionPolicy Bypass -File pipeline/scripts/11_rescan_and_close.ps1 `
  -Scene home `
  -RescanHomeSnapshot "C:\path\new-hometwin-semantic.json" `
  -PersonProfile "C:\path\person-twin.json"
```

脚本会重新计算 Person × Home 风险，然后依据旧行动计划中的 `riskId` 判断哪些行动可以关闭。

## 安全语义

“家属点击已处理”只改变操作界面状态，不代表环境已经安全。只有新一轮 Home Twin 风险投影中对应 `riskId` 消失，行动才会 `resolved`。

Route 2 当前仍属于工程 Demo：候选路线需要真实尺度、连续表面/净宽验证、设备差异测试及现场步行验证。该模块不做医疗诊断或跌倒概率估计。
