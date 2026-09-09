# Home Twin 视觉语义定位

这一层把路线二从“静态/人工标注对象”推进到可运行的感知管线：

`照片 → YOLO-World 开放词汇检测 → 2D bbox → COLMAP images.txt track → 3D anchor → HomeTwinSnapshot`

## 当前识别词表

只开放路线二第一版的六类核心对象：`bed / door / rug / cable / threshold / toilet`。

## 运行

先完成 COLMAP：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\03_run_colmap.ps1 -Scene home
```

然后：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\06_detect_semantics.ps1 -Scene home
```

首次运行 YOLO-World 时会取得预训练权重；权重不应提交到仓库。

## 重要限制

1. 3D 定位依赖 COLMAP 在检测框内留下足够的稀疏重建 track；没有支持时不生成坐标。
2. 当前 `scaleConfidence = 0`，因为普通 COLMAP SfM 没有天然的绝对米制尺度。当前坐标只能作为同一重建坐标系中的相对位置，不能直接解释为“距离 0.7 米”。
3. 当前房间归属暂为 `unknown-room`；房间拓扑需要下一步从门、相机位姿和空间分区中推断。
4. 当前没有把语义对象自动转成 `connects / blocks / on-route` 关系，因此不会伪造“安全路线”。
5. 这是开放词汇零样本检测，不是针对老人家庭数据训练的专用模型；阈值、提示词和后续人工复核仍需要真实采集数据做验证。

目标是先把“视觉证据 + 3D 坐标”做成可信基础，再进入 Person × Home 风险计算。
