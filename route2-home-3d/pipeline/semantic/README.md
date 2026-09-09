# Home Twin 视觉语义与可通行候选路线

这一层把路线二从“静态/人工标注对象”推进到可运行的感知与路线候选管线：

`照片 → YOLO-World 开放词汇检测 → 2D bbox → COLMAP track → 3D anchor → HomeTwinSnapshot → 候选拓扑 → 可通行候选路线`

## 当前识别词表

只开放路线二第一版的六类核心对象：`bed / door / rug / cable / threshold / toilet`。

## 运行

先完成 COLMAP：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\03_run_colmap.ps1 -Scene home
```

然后运行语义识别和候选拓扑：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\06_detect_semantics.ps1 -Scene home
```

再运行可通行候选路线：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\07_plan_walkable_route.ps1 -Scene home
```

首次运行 YOLO-World 时会取得预训练权重；权重不应提交到仓库。

## 当前路线算法是什么

`walkability.py` 目前不是完整的表面级导航系统。它使用已经定位的语义对象锚点建立候选图，在边上进行：

- 线段采样与障碍清除半径检查
- `cable` 硬阻断
- `rug / threshold` 软风险代价
- 对低置信度空间证据增加代价
- Dijkstra 计算床到卫生间的低代价候选路径

因此输出必须标记为 `candidate` / `needs-surface-validation`。

## 重要限制

1. 3D 定位依赖 COLMAP 在检测框内留下足够的稀疏重建 track；没有支持时不生成坐标。
2. 当前 `scaleConfidence = 0`，普通 COLMAP SfM 没有绝对米制尺度。坐标不能直接解释为米。
3. 当前房间归属仍可能是 `unknown-room`；自动房间分区、门洞和空间拓扑仍需真实数据验证。
4. 当前的可通行候选路线仍基于语义锚点，不是从完整地面/墙体/障碍物表面网格中计算自由空间。
5. 当前未验证通行宽度、坡度、真实门洞净宽、家具碰撞体和老人通行余量，因此不能称为“安全导航”。
6. 这是开放词汇零样本检测，不是针对老人家庭数据训练的专用模型；阈值、提示词和后续人工复核仍需要真实采集数据做验证。

下一步真正需要解决的是：从 COLMAP/3DGS 的空间点中恢复地面与障碍表面，建立 2D/2.5D cost map，并使用真实尺度和老人通行余量做路线规划。
