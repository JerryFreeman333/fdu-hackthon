# 路线二 —— COLMAP 相机标定（自动下载 Windows CUDA 版）+ SfM + 去畸变
# 用法: powershell -ExecutionPolicy Bypass -File scripts\03_run_colmap.ps1 -Scene home
param([string]$Scene = "home")
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$external = "$repoRoot\pipeline\external"
$colmapDir = Get-ChildItem "$external\colmap*" -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path "$($_.FullName)\colmap.bat" } | Select-Object -First 1

# ---------- [1/2] 获取 COLMAP ----------
if ($colmapDir) {
    $colmap = "$($colmapDir.FullName)\colmap.bat"
} elseif (Get-Command colmap -ErrorAction SilentlyContinue) {
    $colmap = "colmap"
} else {
    Write-Host "===== 下载 COLMAP (GitHub 官方 release, CUDA 版) =====" -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $external | Out-Null
    $asset = Invoke-RestMethod "https://api.github.com/repos/colmap/colmap/releases/latest" | ForEach-Object { $_.assets } | Where-Object { $_.name -match "windows-cuda\.zip$" } | Select-Object -First 1
    if (-not $asset) { throw "未能从 GitHub 获取 COLMAP 下载地址，请手动下载 https://github.com/colmap/colmap/releases 并解压到 $external" }
    $zip = "$external\$($asset.name)"
    Write-Host "下载 $($asset.browser_download_url) (约 500MB)"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
    Expand-Archive $zip $external -Force
    Remove-Item $zip -Force
    $colmapDir = Get-ChildItem "$external\colmap*" -Directory | Where-Object { Test-Path "$($_.FullName)\colmap.bat" } | Select-Object -First 1
    if (-not $colmapDir) { throw "COLMAP 解压失败" }
    $colmap = "$($colmapDir.FullName)\colmap.bat"
}
Write-Host "COLMAP: $colmap"

# ---------- [2/2] SfM 管线 ----------
$sceneDir = "$repoRoot\pipeline\data\$Scene"
$inputDir = "$sceneDir\input"
$db = "$sceneDir\db.db"
$sparse = "$sceneDir\sparse"
$distilled = "$sceneDir\distilled"
if (-not (Test-Path $inputDir)) { throw "输入目录不存在: $inputDir，先运行 02_prepare_data.ps1" }
New-Item -ItemType Directory -Force -Path $sparse | Out-Null

Write-Host "===== [1/4] 特征提取 =====" -ForegroundColor Cyan
& $colmap feature_extractor --database_path $db --image_path $inputDir `
    --ImageReader.camera_model SIMPLE_RADIAL --ImageReader.single_camera 1 `
    --SiftExtraction.use_gpu 1 --SiftExtraction.max_features 8192
if ($LASTEXITCODE -ne 0) { throw "特征提取失败" }

Write-Host "===== [2/4] 特征匹配（图像多则耗时较长） =====" -ForegroundColor Cyan
& $colmap exhaustive_matcher --database_path $db --SiftMatching.use_gpu 1
if ($LASTEXITCODE -ne 0) { throw "特征匹配失败" }

Write-Host "===== [3/4] 增量式重建 (Mapper) =====" -ForegroundColor Cyan
& $colmap mapper --database_path $db --image_path $inputDir --output_path $sparse
if ($LASTEXITCODE -ne 0) { throw "重建失败（常见原因: 照片重叠不足/纹理太少，见 docs/capture-guide.md）" }
$model = Get-ChildItem "$sparse" -Directory | Select-Object -First 1
if (-not $model) { throw "重建结果为空" }

Write-Host "===== [4/4] 去畸变导出 =====" -ForegroundColor Cyan
& $colmap image_undistorter --image_path $inputDir --input_path $model.FullName `
    --output_path $distilled --output_type COLMAP
if ($LASTEXITCODE -ne 0) { throw "去畸变失败" }

Write-Host "===== COLMAP 完成: $distilled =====" -ForegroundColor Green