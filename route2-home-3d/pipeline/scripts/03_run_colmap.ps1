# 路线二 —— COLMAP 相机标定 + SfM + 去畸变
param([string]$Scene = "home")
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$external = "$repoRoot\pipeline\external"
$sceneDir = "$repoRoot\pipeline\data\$Scene"
$inputDir = "$sceneDir\input"
$db = "$sceneDir\db.db"
$sparse = "$sceneDir\sparse"
$distilled = "$sceneDir\distilled"

if (-not (Test-Path $inputDir -PathType Container)) { throw "输入目录不存在: $inputDir，先运行 02_prepare_data.ps1" }
$count = @(Get-ChildItem $inputDir -File).Count
if ($count -lt 30) { throw "输入图像只有 $count 张，低于安全下限 30；请补充拍摄素材后再重建" }

Remove-Item $db, $sparse, $distilled -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $sparse, $distilled | Out-Null

$colmapDir = Get-ChildItem "$external\colmap*" -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path "$($_.FullName)\colmap.bat" } | Select-Object -First 1

if ($colmapDir) {
    $colmap = "$($colmapDir.FullName)\colmap.bat"
}
elseif (Get-Command colmap -ErrorAction SilentlyContinue) {
    $colmap = "colmap"
}
else {
    Write-Host "===== 下载 COLMAP Windows CUDA 版 =====" -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $external | Out-Null
    $release = Invoke-RestMethod "https://api.github.com/repos/colmap/colmap/releases/latest"
    $asset = $release.assets | Where-Object { $_.name -match "windows-cuda\.zip$" } | Select-Object -First 1
    if (-not $asset) { throw "未能从 COLMAP 最新 release 找到 windows-cuda.zip" }
    $zip = "$external\$($asset.name)"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
    Expand-Archive $zip $external -Force
    Remove-Item $zip -Force
    $colmapDir = Get-ChildItem "$external\colmap*" -Directory | Where-Object { Test-Path "$($_.FullName)\colmap.bat" } | Select-Object -First 1
    if (-not $colmapDir) { throw "COLMAP 解压失败" }
    $colmap = "$($colmapDir.FullName)\colmap.bat"
}

Write-Host "COLMAP: $colmap"
Write-Host "===== [1/4] 特征提取 =====" -ForegroundColor Cyan
& $colmap feature_extractor --database_path $db --image_path $inputDir `
    --ImageReader.camera_model SIMPLE_RADIAL --ImageReader.single_camera 1 `
    --SiftExtraction.use_gpu 1 --SiftExtraction.max_num_features 8192
if ($LASTEXITCODE -ne 0) { throw "特征提取失败" }

Write-Host "===== [2/4] 特征匹配 =====" -ForegroundColor Cyan
& $colmap exhaustive_matcher --database_path $db --SiftMatching.use_gpu 1
if ($LASTEXITCODE -ne 0) { throw "特征匹配失败" }

Write-Host "===== [3/4] 增量式重建 =====" -ForegroundColor Cyan
& $colmap mapper --database_path $db --image_path $inputDir --output_path $sparse
if ($LASTEXITCODE -ne 0) { throw "COLMAP Mapper 执行失败" }
$model = Get-ChildItem "$sparse" -Directory | Sort-Object Name | Select-Object -First 1
if (-not $model) { throw "重建结果为空：没有生成 sparse model" }

$imagesBin = Join-Path $model.FullName "images.bin"
if (-not (Test-Path $imagesBin)) { throw "重建模型缺少 images.bin，结果无效" }
# 将稀疏模型临时转成文本，统计已注册图像数量。
$txtDir = "$sceneDir\sparse_txt"
Remove-Item $txtDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $txtDir | Out-Null
& $colmap model_converter --input_path $model.FullName --output_path $txtDir --output_type TXT
if ($LASTEXITCODE -ne 0) { throw "无法读取 COLMAP 稀疏模型进行质量检查" }
$registered = @(Get-Content "$txtDir\images.txt" | Where-Object { $_ -match '^\d+\s' }).Count
$ratio = $registered / [double]$count
Write-Host ("COLMAP 注册图像: {0}/{1} ({2:P1})" -f $registered, $count, $ratio)
if ($ratio -lt 0.30) { throw ("注册率只有 {0:P1}，低于 30% 质量门槛；请重新拍摄并确保足够重叠与纹理" -f $ratio) }

Write-Host "===== [4/4] 去畸变导出 =====" -ForegroundColor Cyan
& $colmap image_undistorter --image_path $inputDir --input_path $model.FullName `
    --output_path $distilled --output_type COLMAP
if ($LASTEXITCODE -ne 0) { throw "去畸变失败" }
if (-not (Test-Path "$distilled\sparse\cameras.bin")) { throw "去畸变结果缺少 cameras.bin" }
if (-not (Test-Path "$distilled\sparse\images.bin")) { throw "去畸变结果缺少 images.bin" }

Remove-Item $txtDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "===== COLMAP 完成: $distilled =====" -ForegroundColor Green
Write-Host "说明：30% 只是最低注册率门槛；实际家庭建模仍应在 QA 中检查重投影误差、断裂组件和关键区域覆盖。" -ForegroundColor Yellow