# (선택) 데스크톱 앱 조작(computer use) 설치 — Windows 전용
#   powershell -ExecutionPolicy Bypass -File .\install-computer-use.ps1
#
# 외부 오픈소스를 내려받습니다. 실행 전에 아래를 직접 확인하세요:
#   - 프로젝트: https://github.com/sandraschi/windows-computer-use-mcp (MIT, pywinauto 기반)
#   - 고정 버전(커밋): 아래 $Commit — 이 저장소가 시험한 버전. 받은 뒤 정확히 그 커밋인지 확인한다.
#   - 필요: git, uv (https://docs.astral.sh/uv/), node
# 하는 일:
#   1) %USERPROFILE%\.gemini\antigravity\scratch\windows-computer-use-mcp 에 고정 커밋으로 받기
#   2) uv sync --frozen 으로 파이썬 환경 만들기
#   3) %USERPROFILE%\.gemini\config\mcp_config.json 에 "windows-computer-use" 서버 추가 (기존 파일은 .bak 백업, node 로 편집)
#      키로거·얼굴인식·궤적 기록·클립보드 읽기는 끈 채로 등록한다.
# 마우스·키보드 조작은 서버가 매번 승인(approve_automation)을 요구하며, 에이전트는 스스로 승인하지 않도록
# computer-use 스킬에 적혀 있습니다.
param([ValidatePattern('^[0-9a-f]{40}$')][string]$Commit = 'b71afd0cd164508e36b1bbce482b26630377f54a')
$ErrorActionPreference = 'Stop'

function Invoke-Native([string]$exe, [string[]]$argList) {
  $global:LASTEXITCODE = 0
  & $exe @argList
  if ($LASTEXITCODE -ne 0) { throw "$exe 실패 (종료 코드 $LASTEXITCODE): $($argList -join ' ')" }
}

foreach ($c in 'git', 'uv', 'node') { if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { throw "$c 이(가) 필요합니다." } }
$dir = Join-Path $env:USERPROFILE '.gemini\antigravity\scratch\windows-computer-use-mcp'
$mcp = Join-Path $env:USERPROFILE '.gemini\config\mcp_config.json'
$jsonEdit = Join-Path $PSScriptRoot 'tools\json-edit.mjs'

$answer = Read-Host "외부 저장소 sandraschi/windows-computer-use-mcp ($($Commit.Substring(0,8))) 를 받아 설치할까요? (y/N)"
if ($answer -notmatch '^(y|yes|ㅇ|예)$') { Write-Host '취소했습니다.'; exit 0 }

if (-not (Test-Path -LiteralPath (Join-Path $dir '.git'))) {
  if (Test-Path -LiteralPath $dir) { throw "$dir 가 이미 있는데 git 저장소가 아닙니다. 확인 후 옮기거나 지우고 다시 실행하세요." }
  Invoke-Native git @('clone', '--quiet', 'https://github.com/sandraschi/windows-computer-use-mcp.git', $dir)
}
Invoke-Native git @('-C', $dir, 'fetch', '--quiet', 'origin')
Invoke-Native git @('-C', $dir, 'checkout', '--quiet', $Commit)
$head = (git -C $dir rev-parse HEAD).Trim()
if ($head -ne $Commit) { throw "받은 커밋($head)이 고정 커밋($Commit)과 다릅니다. 중단합니다." }

Push-Location -LiteralPath $dir
try { Invoke-Native uv @('sync', '--frozen') } finally { Pop-Location }

$py = Join-Path $dir '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $py)) { throw "파이썬 환경을 만들지 못했습니다: $py" }
$logs = Join-Path $dir 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

# 서버 설정을 임시 JSON 파일로 만든 뒤 node 로 mcp_config.json 에 넣는다 (PowerShell JSON 변환으로 기존 설정이 망가지지 않게)
$server = [ordered]@{
  command = $py
  args    = @('-m', 'windows_computer_use_mcp.main', '--stdio')
  env     = [ordered]@{
    MCP_TRANSPORT                                   = 'stdio'
    WINDOWS_COMPUTER_USE_MCP_LOG_DIR                = $logs
    WINDOWS_COMPUTER_USE_MCP_TELEMETRY_DIR          = $logs
    windows_computer_use_mcp_ENABLE_KEYLOGGER       = '0'
    windows_computer_use_mcp_ENABLE_FACE            = '0'
    windows_computer_use_mcp_TRAJECTORY_LOG         = '0'
    WINDOWS_COMPUTER_USE_MCP_DISABLE_CLIPBOARD_READ = '1'
    windows_computer_use_mcp_DISPATCH               = 'foreground'
  }
}
$tmp = Join-Path $env:TEMP ("cu-server-" + [guid]::NewGuid().ToString('N') + '.json')
try {
  [IO.File]::WriteAllText($tmp, ($server | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
  Invoke-Native node @($jsonEdit, 'set-mcp', $mcp, 'windows-computer-use', $tmp)
} finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
Write-Host 'Antigravity 앱을 다시 시작한 뒤 "메모장 열어서 hello 써줘" 처럼 시켜 보세요 (computer-use 스킬).'
