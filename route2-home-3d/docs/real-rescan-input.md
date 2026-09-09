# Route 2：真实复扫输入

真实复扫不直接覆盖上一轮 Home Twin。每次复扫都创建独立批次和独立场景，保留前后版本用于比较。

## 浏览器入口

3D Web 的“家庭行动”页签中点击“已处理？重新扫描确认”，浏览器只接受明确选择的照片/视频文件：JPG、PNG、WebP、HEIC/HEIF、MP4、WebM、MOV/M4V。

浏览器生成 `home-twin-rescan-manifest`，记录批次 ID、采集时间、媒体类型和文件元数据；原始媒体不写入 Home Twin JSON。

默认上传接口：`POST /api/route2/rescan`，multipart 字段：

- `batchId`
- `capturedAt`
- `mediaKind`
- `manifest`
- `files`

服务端/本地管线返回：

```json
{
  "status": "queued | processing | ready | failed",
  "jobId": "optional",
  "message": "optional",
  "latestRiskIds": ["person-home-night-route"],
  "actionPlan": "optional person-home-action-plan"
}
```

## 本地真实重建

```powershell
powershell -ExecutionPolicy Bypass -File scripts\12_rescan_home.ps1 `
  -Photos "C:\path\rescan-photos" `
  -PreviousScene home `
  -PersonProfile "C:\path\person.json" `
  -ScaleFile "C:\path\scale.json"
```

或：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\12_rescan_home.ps1 `
  -Video "C:\path\rescan.mp4" `
  -PreviousScene home `
  -PersonProfile "C:\path\person.json"
```

该脚本把复扫数据写入独立 `home-rescan` 场景，再执行 COLMAP、语义识别、表面路线、Person × Home 风险和行动计划继承。旧场景不会被覆盖。

## 关闭规则

上一轮 action 通过 `riskId` 与最新风险集合比较：

- 旧风险消失：`resolvedBy = rescan`
- 旧风险继续存在：保持 `open/in_progress`
- 新风险出现：追加新的 action

因此“家属点击已处理”不会直接代表“环境已安全”。