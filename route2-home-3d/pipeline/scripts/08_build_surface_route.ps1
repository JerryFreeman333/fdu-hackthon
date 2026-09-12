# 路线二 —— 按老人通行模型生成表面级可通行候选路线
param(
    [string]$Scene = "home",
    [double]$Cell = 0.05,
    [double]$PlaneThreshold = 0.02,
    [double]$ObstacleHeight = 0.08,
    [string]$ClearanceProfile = "",
    [string]$ScaleFile = ""
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sceneDir = "$repoRoot\pipeline\data\$Scene"
$semanticDir = "$sceneDir\semantic"
$input = "$semanticDir\hometwin-semantic.json"
$output = "$semanticDir\hometwin-surface-route.json"
$points = "$semanticDir\colmap_txt\points3D.txt"
$defaultProfile = "$repoRoot\pipeline\semantic\mobility-profile.example.json"

if (-not (Test-Path $input)) { throw "缺少语义 Home Twin: $input，请先运行 06_detect_semantics.ps1" }
if (-not (Test-Path $points)) { throw "缺少 COLMAP points3D.txt，请先运行 06_detect_semantics.ps1" }
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw "找不到 python" }
if (-not $ClearanceProfile) { $ClearanceProfile = $defaultProfile }
if (-not (Test-Path $ClearanceProfile)) { throw "通行模型不存在: $ClearanceProfile" }

$args = @(
    "$repoRoot\pipeline\semantic\personalized_surface_route.py",
    '--snapshot', $input,
    '--points', $points,
    '--output', $output,
    '--profile', $ClearanceProfile,
    '--cell', $Cell,
    '--plane-threshold', $PlaneThreshold,
    '--obstacle-height', $ObstacleHeight
)
if ($ScaleFile) { $args += @('--scale', $ScaleFile) }

Write-Host "===== 按通行模型构建表面代价图 =====" -ForegroundColor Cyan
Write-Host "Mobility profile: $ClearanceProfile"
& $python.Source @args
if ($LASTEXITCODE -ne 0) { throw "表面代价图/个体化路线计算失败" }
Write-Host "表面路线输出: $output" -ForegroundColor Green
Write-Host "注意：结果仍是 candidate，不代表现场验证的安全路线。" -ForegroundColor Yellow
