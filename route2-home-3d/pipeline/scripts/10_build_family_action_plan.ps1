# Route 2 —— 将 Person × Home 风险转成可执行、可复扫关闭的家庭任务
param(
    [string]$Scene = "home",
    [string]$RiskProjection = "",
    [string]$Output = ""
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$semanticDir = "$repoRoot\pipeline\data\$Scene\semantic"
if (-not $RiskProjection) { $RiskProjection = "$semanticDir\person-home-risk.json" }
if (-not $Output) { $Output = "$semanticDir\person-home-action-plan.json" }
if (-not (Test-Path $RiskProjection)) { throw "缺少风险投影: $RiskProjection，请先运行 09_project_person_home_risk.ps1" }
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw "找不到 python" }
$args = @(
    "$repoRoot\pipeline\semantic\person_home_action_plan.py",
    '--risk', $RiskProjection,
    '--output', $Output
)
Write-Host "===== Person × Home → Family Action =====" -ForegroundColor Cyan
& $python.Source @args
if ($LASTEXITCODE -ne 0) { throw "家庭行动计划生成失败" }
Write-Host "家庭行动计划输出: $Output" -ForegroundColor Green
Write-Host "注意：只有复扫确认风险消失，任务才会自动 resolved。" -ForegroundColor Yellow
