# Route 2 —— 真实复扫：新的照片/视频 → 独立复扫场景 → Person × Home 风险 → 继承旧行动计划
param(
    [string]$Video,
    [string]$Photos,
    [string]$Scene = "home-rescan",
    [string]$PreviousScene = "home",
    [string]$PersonProfile = "",
    [string]$PreviousPlan = "",
    [string]$ScaleFile = "",
    [int]$Fps = 2,
    [int]$Iterations = 30000
)
$ErrorActionPreference = 'Stop'
$scripts = $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $scripts)
$semanticDir = "$repoRoot\pipeline\data\$Scene\semantic"
$previousSemanticDir = "$repoRoot\pipeline\data\$PreviousScene\semantic"
$defaultPerson = "$repoRoot\pipeline\semantic\person-twin.example.json"
if (-not $PersonProfile) { $PersonProfile = $defaultPerson }
if (-not $PreviousPlan) { $PreviousPlan = "$previousSemanticDir\person-home-action-plan.json" }
$rescanRisk = "$semanticDir\person-home-risk.json"
$rescanPlan = "$semanticDir\person-home-action-plan.rescan.json"

if ([string]::IsNullOrWhiteSpace($Video) -eq [string]::IsNullOrWhiteSpace($Photos)) {
    throw "必须且只能指定 -Video 或 -Photos"
}
if (-not (Test-Path $PersonProfile)) { throw "Person Twin 不存在: $PersonProfile" }
if (-not (Test-Path $PreviousPlan)) { throw "上一轮行动计划不存在: $PreviousPlan" }

Write-Host "########## Route 2 · 真实 Home Twin 复扫 ##########" -ForegroundColor Cyan
& "$scripts\02_prepare_data.ps1" -Video $Video -Photos $Photos -Scene $Scene -Fps $Fps
& "$scripts\03_run_colmap.ps1" -Scene $Scene
& "$scripts\06_detect_semantics.ps1" -Scene $Scene
& "$scripts\07_plan_walkable_route.ps1" -Scene $Scene
$surfaceArgs = @('-Scene', $Scene)
if ($ScaleFile) { $surfaceArgs += @('-ScaleFile', $ScaleFile) }
& "$scripts\08_build_surface_route.ps1" @surfaceArgs
& "$scripts\09_project_person_home_risk.ps1" -Scene $Scene -PersonProfile $PersonProfile

$latestRisk = $rescanRisk
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw "找不到 python" }
& $python.Source "$repoRoot\pipeline\semantic\person_home_action_plan.py" --risk $latestRisk --output $rescanPlan --rescan-plan $PreviousPlan
if ($LASTEXITCODE -ne 0) { throw "复扫行动计划合并失败" }

& "$scripts\04_train_3dgs.ps1" -Scene $Scene -Iterations $Iterations
& "$scripts\05_export_web.ps1" -Scene $Scene
Write-Host "复扫完成。" -ForegroundColor Green
Write-Host "风险投影: $latestRisk"
Write-Host "行动计划: $rescanPlan"
Write-Host "说明：新场景独立保存，不覆盖上一轮 Home Twin；只有 riskId 消失才会 resolved。" -ForegroundColor Yellow
