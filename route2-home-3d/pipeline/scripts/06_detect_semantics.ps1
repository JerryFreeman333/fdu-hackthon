# 路线二 —— 视觉语义识别 + COLMAP 3D 定位 + 候选空间拓扑
# 输出: pipeline/data/<Scene>/semantic/hometwin-semantic.json
param(
    [string]$Scene = "home",
    [string]$Model = "yolov8s-worldv2.pt",
    [double]$Confidence = 0.20,
    [int]$MinTrackPoints = 3,
    [double]$ClusterDistance = 0.75,
    [double]$MinRelationConfidence = 0.18
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sceneDir = "$repoRoot\pipeline\data\$Scene"
$imagesDir = "$sceneDir\input"
$distilledSparse = "$sceneDir\distilled\sparse"
$semanticDir = "$sceneDir\semantic"
$colmapTxt = "$semanticDir\colmap_txt"
$detectedOutput = "$semanticDir\detections.json"
$output = "$semanticDir\hometwin-semantic.json"

if (-not (Test-Path $imagesDir -PathType Container)) { throw "输入图像目录不存在: $imagesDir" }
if (-not (Test-Path "$distilledSparse\images.bin")) { throw "缺少去畸变后的 COLMAP images.bin，请先运行 03_run_colmap.ps1" }
if (-not (Test-Path "$distilledSparse\points3D.bin")) { throw "缺少 COLMAP points3D.bin，请先完成 SfM" }

$colmapDir = Get-ChildItem "$repoRoot\pipeline\external\colmap*" -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path "$($_.FullName)\colmap.bat" } | Select-Object -First 1
if ($colmapDir) { $colmap = "$($colmapDir.FullName)\colmap.bat" }
elseif (Get-Command colmap -ErrorAction SilentlyContinue) { $colmap = "colmap" }
else { throw "找不到 COLMAP；请先运行 03_run_colmap.ps1" }

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw "找不到 python" }

Remove-Item $semanticDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $colmapTxt | Out-Null

Write-Host "===== [1/4] 导出 COLMAP 稀疏模型文本 =====" -ForegroundColor Cyan
& $colmap model_converter --input_path $distilledSparse --output_path $colmapTxt --output_type TXT
if ($LASTEXITCODE -ne 0) { throw "COLMAP model_converter 失败" }
foreach ($required in @("$colmapTxt\images.txt", "$colmapTxt\points3D.txt")) {
    if (-not (Test-Path $required)) { throw "缺少 COLMAP 文本模型文件: $required" }
}

Write-Host "===== [2/4] 检查语义检测依赖 =====" -ForegroundColor Cyan
& $python.Source -c "import ultralytics; from PIL import Image; print('semantic runtime ok:', ultralytics.__version__)"
if ($LASTEXITCODE -ne 0) {
    throw "缺少语义识别依赖。请执行: python -m pip install -r pipeline\semantic\requirements.txt"
}

Write-Host "===== [3/4] 运行视觉识别 + 3D anchor =====" -ForegroundColor Cyan
& $python.Source "$repoRoot\pipeline\semantic\detect_and_localize.py" `
    --images $imagesDir `
    --colmap $colmapTxt `
    --output $detectedOutput `
    --model $Model `
    --confidence $Confidence `
    --min-track-points $MinTrackPoints `
    --cluster-distance $ClusterDistance
if ($LASTEXITCODE -ne 0) { throw "语义识别/3D 定位失败" }

Write-Host "===== [4/4] 推断候选空间拓扑 =====" -ForegroundColor Cyan
& $python.Source "$repoRoot\pipeline\semantic\topology.py" `
    --input $detectedOutput `
    --output $output `
    --min-confidence $MinRelationConfidence
if ($LASTEXITCODE -ne 0) { throw "空间拓扑推断失败" }

Write-Host "语义 Home Twin 已生成: $output" -ForegroundColor Green
Write-Host "注意：拓扑关系为 candidate，不是已验证的安全通道；COLMAP 坐标仍为 colmap-arbitrary，未做实测标尺前不得解释为米制距离。" -ForegroundColor Yellow
