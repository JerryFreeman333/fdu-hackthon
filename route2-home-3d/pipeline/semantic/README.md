# Home Twin 视觉语义与表面可通行候选路线

当前路线二管线：

`照片 → YOLO-World 开放词汇检测 → 2D bbox → COLMAP track → 3D anchor → HomeTwinSnapshot → 候选拓扑 → 语义可通行候选 → 表面代价图 → A*`

## 当前识别词表

只开放路线二第一版的六类核心对象：`bed / door / rug / cable / threshold / toilet`。

## 运行

完成 COLMAP 和语义定位后：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\06_detect_semantics.ps1 -Scene home
powershell -ExecutionPolicy Bypass -File scripts\07_plan_walkable_route.ps1 -Scene home
powershell -ExecutionPolicy Bypass -File scripts\08_build_surface_route.ps1 -Scene home
```

全流程：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run_all.ps1 -Photos "C:\path\photos" -Scene home
```

## 表面路线这一层实际做什么

`surface_costmap.py` 不再只比较床、门、卫生间等对象中心之间的距离，而是尝试从 COLMAP `points3D.txt` 恢复一个候选地面平面，并建立 2.5D 栅格：

1. 使用 RANSAC 找到具有最大平面支持的候选平面。
2. 将点云投影到该平面，得到 2D 地面坐标。
3. 有地面证据的栅格才允许作为自由空间；无地面证据的栅格默认阻断，避免稀疏点云被误当成可走区域。
4. 高于候选平面的稀疏点形成障碍候选，并进行通行余量膨胀。
5. `cable` 投影为硬阻断；`rug / threshold` 添加软代价。
6. 在栅格上使用 A* 而不是直接连接对象中心。

## 绝对尺度

普通 COLMAP SfM 的坐标没有天然的绝对米制尺度。因此当前参数如 `cell=0.05`、`clearance=0.18` 默认都是 reconstruction-unit。

需要实测时，复制：

```text
pipeline/semantic/scale.example.json
```

将 `metresPerUnit` 换成根据已知实测距离得到的比例，再运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\08_build_surface_route.ps1 -Scene home -ScaleFile "C:\path\scale.json"
```

未提供尺度时，输出中的 `metricScaleAvailable=false`，不能把路径长度解释成米。

## 当前安全边界

即使产生了表面候选路线，状态仍为 `needs-real-scale-and-surface-validation`。原因包括：

- RANSAC 得到的是“候选地面”，COLMAP 本身不提供可靠的重力方向；最大平面也可能是墙面、桌面或其他大平面。
- 稀疏点云不是连续网格，家具遮挡区域可能没有足够的表面点。
- 尚未验证真实门洞净宽、坡度、障碍物真实体积和老人通行余量。
- 语义障碍物本身的 3D anchor 仍依赖检测框内的 COLMAP tracks。

因此这一层的正确定位是：**从语义候选导航迈向表面空间导航的实验性桥接层**，而不是已经部署的老人安全导航。
