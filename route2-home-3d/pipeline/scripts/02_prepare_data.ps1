# 路线二 —— 数据准备：视频抽帧或照片整理成 COLMAP 输入格式
# 用法1(视频): powershell -ExecutionPolicy Bypass -File scripts\02_prepare_data.ps1 -Video "C:\path\living_room.mp4" -Scene home
# 用法2(照片): powershell -ExecutionPolicy Bypass -File scripts\02_prepare_data.ps1 -Photos "C:\path\photos" -Scene home
param(
    [string]$Video,
    [string]$Photos,
    [string]$Scene = "home",
    [int]$Fps = 2,            # 视频抽帧帧率，房间场景 2fps 足够
    [int]$MaxWidth = 1920     # 抽帧最大宽度，过大费显存
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sceneDir = "$repoRoot\pipeline\data\$Scene"
$inputDir = "$sceneDir\input"
New-Item -ItemType Directory -Force -Path $inputDir | Out-Null

if ($Video) {
    if (-not (Test-Path $Video)) { throw "视频不存在: $Video" }
    Write-Host "===== 视频抽帧: $Video -> $inputDir (fps=$Fps) =====" -ForegroundColor Cyan
    ffmpeg -y -i $Video -vf "fps=$Fps,scale='min($MaxWidth,iw)':-2" -q:v 1 "$inputDir\frame_%04d.jpg"
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg 抽帧失败" }
}
elseif ($Photos) {
    if (-not (Test-Path $Photos)) { throw "照片目录不存在: $Photos" }
    Write-Host "===== 复制照片: $Photos -> $inputDir =====" -ForegroundColor Cyan
    $i = 0
    Get-ChildItem $Photos -File -Include *.jpg,*.jpeg,*.png,*.JPG,*.JPEG,*.HEIC -Recurse | ForEach-Object {
        $i++
        Copy-Item $_.FullName "$inputDir\photo_{0:D4}$($_.Extension.ToLower())" -Force
    }
    if ($i -eq 0) { throw "目录中未找到照片(jpg/png/heic)" }
}
else { throw "必须指定 -Video 或 -Photos" }

$count = (Get-ChildItem $inputDir -File).Count
Write-Host "输入图像共 $count 张: $inputDir" -ForegroundColor Green
if ($count -lt 30) { Write-Host "警告: 图像少于 30 张，重建质量可能较差（建议 60~200 张）" -ForegroundColor Yellow }