# 路线二 —— 数据准备：视频抽帧或照片整理成 COLMAP 输入格式
# 用法1(视频): powershell -ExecutionPolicy Bypass -File scripts\02_prepare_data.ps1 -Video "C:\path\living_room.mp4" -Scene home
# 用法2(照片): powershell -ExecutionPolicy Bypass -File scripts\02_prepare_data.ps1 -Photos "C:\path\photos" -Scene home
param(
    [string]$Video,
    [string]$Photos,
    [string]$Scene = "home",
    [int]$Fps = 2,
    [int]$MaxWidth = 1920
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sceneDir = "$repoRoot\pipeline\data\$Scene"
$inputDir = "$sceneDir\input"

if ([string]::IsNullOrWhiteSpace($Video) -eq [string]::IsNullOrWhiteSpace($Photos)) {
    throw "必须且只能指定 -Video 或 -Photos"
}
if ($Fps -lt 1) { throw "-Fps 必须 >= 1" }
if ($MaxWidth -lt 640) { throw "-MaxWidth 建议不要低于 640" }

$ffmpeg = $null
if ($Video) {
    $ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if (-not $ffmpeg) {
        $ffmpeg = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\*\bin\ffmpeg.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if (-not $ffmpeg) { throw "未找到 ffmpeg.exe；请将 ffmpeg 加入 PATH 或通过 winget 安装 Gyan.FFmpeg。" }
    $ffmpegPath = if ($ffmpeg.PSObject.Properties['Source']) { $ffmpeg.Source } else { $ffmpeg.FullName }
}

# 每次运行从干净场景开始，避免不同家庭/不同扫描混入同一个 COLMAP 数据库。
if (Test-Path $sceneDir) {
    Remove-Item $inputDir, "$sceneDir\db.db", "$sceneDir\sparse", "$sceneDir\distilled" -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $inputDir | Out-Null

if ($Video) {
    if (-not (Test-Path $Video -PathType Leaf)) { throw "视频不存在: $Video" }
    Write-Host "===== 视频抽帧: $Video -> $inputDir (fps=$Fps) =====" -ForegroundColor Cyan
    & $ffmpegPath -y -i $Video -vf "fps=$Fps,scale='min($MaxWidth,iw)':-2" -q:v 2 "$inputDir\frame_%04d.jpg"
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg 抽帧失败" }
}
else {
    if (-not (Test-Path $Photos -PathType Container)) { throw "照片目录不存在: $Photos" }
    Write-Host "===== 复制照片: $Photos -> $inputDir =====" -ForegroundColor Cyan
    $i = 0
    Get-ChildItem $Photos -File -Recurse | Where-Object { $_.Extension -match '^\.(jpg|jpeg|png)$' } | ForEach-Object {
        $i++
        Copy-Item $_.FullName (Join-Path $inputDir ("photo_{0:D4}{1}" -f $i, $_.Extension.ToLower())) -Force
    }
    if ($i -eq 0) { throw "目录中未找到 JPG/JPEG/PNG 图片；请先转成兼容格式" }
}

$count = @(Get-ChildItem $inputDir -File).Count
if ($count -lt 30) {
    Write-Host "警告: 图像只有 $count 张，建议至少 60 张；少于 30 张通常不适合稳定重建" -ForegroundColor Yellow
}
Write-Host "输入图像共 $count 张: $inputDir" -ForegroundColor Green
