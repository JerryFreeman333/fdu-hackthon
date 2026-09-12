# Route 2 —— 使用新一轮 Home Twin 风险投影验证家庭行动是否真正关闭
param(
    [string]$Scene = "home",
    [string]$RescanHomeSnapshot,
    [string]$PersonProfile = "",
    [string]$PreviousPlan = "",
    [string]$Output = ""
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$semanticDir = "$repoRoot\pipeline\data\$Scene\semantic"
$defaultPerson = "$repoRoot\pipeline\semantic\person-twin.example.json"
if (-not $PersonProfile) { $PersonProfile = $defaultPerson }
if (-not $PreviousPlan) { $PreviousPlan = "$semanticDir\person-home-action-plan.json" }
if (-not $Output) { $Output = "$semanticDir\person-home-action-plan.rescan.json" }
if (-not (Test-Path $RescanHomeSnapshot)) { throw "复扫 Home Twin 不存在: $RescanHomeSnapshot" }
if (-not (Test-Path $PersonProfile)) { throw "Person Twin 不存在: $PersonProfile" }
if (-not (Test-Path $PreviousPlan)) { throw "既有家庭行动计划不存在: $PreviousPlan，请先运行 10_build_family_action_plan.ps1" }
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw "找不到 python" }

$tempRisk = "$semanticDir\person-home-risk.rescan.json"
$riskArgs = @(
    "$repoRoot\pipeline\semantic\person_home_risk.py",
    '--person', $PersonProfile,
    '--home', $RescanHomeSnapshot,
    '--output', $tempRisk
)
Write-Host "===== Home Twin 复扫：重新计算 Person × Home 风险 =====" -ForegroundColor Cyan
& $python.Source @riskArgs
if ($LASTEXITCODE -ne 0) { throw "复扫后的风险投影生成失败" }

$planArgs = @(
    "$repoRoot\pipeline\semantic\person_home_action_plan.py",
    '--risk', $tempRisk,
    '--output', $Output,
    '--rescan-risk', $tempRisk
)
# 保留既有行动项与风险 ID 的闭环语义；Python 入口会把当前风险消失映射为 resolved。
# 传入旧计划进行状态继承，避免重复生成同一批动作。
$planArgs = @(
    "$repoRoot\pipeline\semantic\person_home_action_plan.py",
    '--risk', $tempRisk,
    '--output', $Output,
    '--rescan-plan', $PreviousPlan
)
Write-Host "===== 复扫结果：更新家庭行动状态 =====" -ForegroundColor Cyan
& $python.Source @planArgs
if ($LASTEXITCODE -ne 0) { throw "复扫后行动计划更新失败" }
Write-Host "复扫后的家庭行动计划: $Output" -ForegroundColor Green
Write-Host "只有最新风险投影中对应 riskId 消失，任务才会 resolved。" -ForegroundColor Yellow
