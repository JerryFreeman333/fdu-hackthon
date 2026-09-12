# Route 2 Rescan Backend

本地 FastAPI 后端只负责 **复扫输入接收、任务排队、处理状态和结果回传**。真实摄像头/深度设备不直接写入业务逻辑，而是未来实现 `CaptureSource` 接口，把照片/视频帧转换成相同的 `CaptureBatch`。

## 本地运行

```bash
cd route2-home-3d
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8010 --reload
```

Windows PowerShell：

```powershell
cd route2-home-3d
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8010 --reload
```

默认 `ROUTE2_PROCESSOR_MODE=queue`：真实媒体会经过完整上传、校验、落盘和任务状态链路，但**不会伪造新的空间风险结果**。因此上传成功不会自动关闭旧行动。

在已准备好 Windows + PowerShell + COLMAP/3DGS 环境后，可以显式启用真实 pipeline：

```powershell
$env:ROUTE2_PROCESSOR_MODE="local-pipeline"
$env:ROUTE2_ENABLE_PIPELINE="1"
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8010
```

真实 pipeline 使用 `pipeline/scripts/12_rescan_home.ps1`，结果仍经过 `person-home-risk.json` 与 `person-home-action-plan.rescan.json` 才能更新前端行动状态。

## API

`GET /api/route2/health`

返回处理器模式与硬件适配状态。

`POST /api/route2/rescan`

`multipart/form-data` 字段：`batchId`、`capturedAt`、`mediaKind`、`manifest`、`files`（注意字段名是 `files`，不是 `files[]`）。成功返回 HTTP 202 与 `jobId`。

`manifest` 是 JSON 字符串，必须与表单字段保持一致：

```json
{
  "id": "<与表单 batchId 完全相同>",
  "capturedAt": "<与表单 capturedAt 完全相同>",
  "kind": "<与表单 mediaKind 完全相同：image 或 video>",
  "files": [
    { "name": "photo1.jpg", "size": 123456, "type": "image/jpeg" }
  ]
}
```

其中每个 `files` 项的 `name` 必须与该上传文件的原始文件名一致，`size` 必须与实际字节数一致，`type` 必须与该分片的 Content-Type（MIME）一致。curl 示例：

```bash
curl -X POST http://127.0.0.1:8010/api/route2/rescan \
  -F "batchId=demo-001" \
  -F "capturedAt=2026-09-12T20:00:00+08:00" \
  -F "mediaKind=image" \
  -F 'manifest={"id":"demo-001","capturedAt":"2026-09-12T20:00:00+08:00","kind":"image","files":[{"name":"a.jpg","size":415,"type":"image/jpeg"}]}' \
  -F "files=@a.jpg;type=image/jpeg"
```

校验失败时返回 422，detail 会逐项指出哪个字段不一致及期望值/实际值。

上传限额（可用环境变量调整）：`ROUTE2_MAX_FILE_BYTES`（默认 50MB/文件）、`ROUTE2_MAX_TOTAL_BYTES`（默认 200MB/批次）、`ROUTE2_MAX_FILES`（默认 60 个/批次）。超限返回 413。

`GET /api/route2/rescan/{jobId}`

轮询 `queued → processing → ready/failed`；只有 `ready` 且存在新的风险投影时，前端才会应用新的风险/行动状态。任务状态会落盘到 `backend/.data/jobs/index.json`，服务重启后已结束的任务仍可查询；重启时仍在排队/处理中的任务会被如实标记为失败，请重新提交。

## 部署边界

本后端面向**本机或可信家庭内网**的单用户原型使用：

- 未做用户体系；设置环境变量 `ROUTE2_API_TOKEN`（任意随机串）后，`POST /api/route2/rescan` 与 `GET /api/route2/rescan/{jobId}` 都要求请求头 `X-Route2-Token` 匹配，否则返回 401。前端当前不发送该请求头，启用 token 时需自行在 `RESCAN_ENDPOINT` 调用侧补充。
- FastAPI 默认的 `/docs`、`/redoc`、`/openapi.json` 交互式接口文档**默认关闭**（避免向局域网暴露接口结构）；本地调试需要时设置 `ROUTE2_ENABLE_DOCS=1` 再启动。
- 单工作者队列（`max_workers=1`）；管线子进程自带超时（`ROUTE2_PIPELINE_TIMEOUT_SECONDS`，默认 1800 秒），超时任务会标记为 failed，不会永久堵死队列，但排在其后的任务仍需顺序执行。
- 请勿将端口暴露到公网。

## 隐私与留存

原始上传默认写入 `backend/.data/jobs/<jobId>/`，任务处理结束后自动删除。设置 `ROUTE2_KEEP_INPUT=1` 才保留输入供本地调试。`.data/` 永不提交到 Git。

本服务不接收 Route 1 原始聊天、原始健康事件或其他私密对话内容；Person Twin 仅通过显式配置的结构化文件提供功能状态字段。
