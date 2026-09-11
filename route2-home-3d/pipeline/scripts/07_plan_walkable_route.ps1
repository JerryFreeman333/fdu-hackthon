# 路线二 —— 可通行候选路线 + 风险代价
# 输入: pipeline/data/<Scene>/semantic/hometwin-semantic.json
# 输出: pipeline/data/<Scene>/semantic/hometwin-route.json
param([string]$Scene = "home")
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sceneDir = "$repoRoot\pipeline\data\$Scene"
$semanticDir = "$sceneDir\semantic"
$input = "$semanticDir\hometwin-semantic.json"
$output = "$semanticDir\hometwin-route.json"

if (-not (Test-Path $input)) { throw "缺少语义 Home Twin: $input，请先运行 06_detect_semantics.ps1" }
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw "找不到 python" }

Write-Host "===== 生成可通行候选路线 =====" -ForegroundColor Cyan
& $python.Source "$repoRoot\pipeline\semantic\walkability.py" --input $input --output $output
if ($LASTEXITCODE -ne 0) { throw "可通行候选路线计算失败" }
Write-Host "候选路线输出: $output" -ForegroundColor Green
Write-Host "注意：当前仍不是现场验证的安全路线；绝对尺度、表面级障碍、通行宽度和人工复核尚未完成。" -ForegroundColor Yellow
