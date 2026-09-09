# 路线二 —— 表面级可通行候选路线
# 输入: COLMAP sparse 3D points + hometwin-semantic.json
# 输出: pipeline/data/<Scene>/semantic/hometwin-surface-route.json
param(
    [string]$Scene = "home",
    [double]$Cell = 0.05,
    [double]$PlaneThreshold = 0.02,
    [double]$ObstacleHeight = 0.08,
    [double]$Clearance = 0.18,
    [string]$ScaleFile = ""
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sceneDir = "$repoRoot\pipeline\data\$Scene"
$semanticDir = "$sceneDir\semantic"
$input = "$semanticDir\hometwin-semantic.json"
$output = "$semanticDir\hometwin-surface-route.json"
$points = "$semanticDir\colmap_txt\points3D.txt"

if (-not (Test-Path $input)) { throw "缺少语义 Home Twin: $input，请先运行 06_detect_semantics.ps1" }
if (-not (Test-Path $points)) {
    throw "缺少 COLMAP points3D.txt: $points，请先运行 06_detect_semantics.ps1（它会导出文本模型）"
}
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw "找不到 python" }

$args = @(
    "$repoRoot\pipeline\semantic\surface_costmap.py",
    '--snapshot', $input,
    '--points', $points,
    '--output', $output,
    '--cell', $Cell,
    '--plane-threshold', $PlaneThreshold,
    '--obstacle-height', $ObstacleHeight,
    '--clearance', $Clearance
)
if ($ScaleFile) { $args += @('--scale', $ScaleFile) }

Write-Host "===== 从 COLMAP 稀疏点云构建表面代价图 =====" -ForegroundColor Cyan
& $python.Source @args
if ($LASTEXITCODE -ne 0) { throw "表面代价图/路线计算失败" }
Write-Host "表面路线输出: $output" -ForegroundColor Green
Write-Host "注意：未提供 scale.json 时仍属于 reconstruction-unit；未进行现场通行宽度验证。" -ForegroundColor Yellow
