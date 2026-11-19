# Antigravity Implant 설치 (Windows PowerShell 5.1 이상)
#   powershell -ExecutionPolicy Bypass -File .\install.ps1                                  # 플러그인만 설치·업데이트
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -StatusLine                      # + agy CLI 상태줄 설정
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -ReadableReplies                 # + GEMINI.md 읽기 쉬운 답 규칙(자동 언어 감지)
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -ReadableReplies -Lang ko        # + 언어 직접 지정 (ko, en, ja, zh-CN, zh-TW, es, fr, de, pt 등)
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall                       # 제거 (데이터 폴더는 남김)
#
# 하는 일: 플러그인을 임시 폴더에 복사해 검증한 뒤 %USERPROFILE%\.gemini\config\plugins\antigravity-implant 로 바꿔 넣는다.
#          (이전 설치본은 plugins 폴더 밖 백업 폴더로 옮기고, 실패하면 되돌린다)
# 하지 않는 일: 레지스트리·환경 변수·서비스 변경, 관리자 권한, 권한(허용 목록) 변경, 외부 다운로드.
# 설정·규칙 파일을 바꾸는 일(-StatusLine, -ReadableReplies, -Uninstall 정리)은 node 로 하고, 바꾸기 전에 .bak 백업을 만든다.
param([switch]$StatusLine, [switch]$ReadableReplies, [string]$Lang = 'auto', [switch]$Uninstall)
$ErrorActionPreference = 'Stop'

function Invoke-Native([string]$exe, [string[]]$argList) {
  $global:LASTEXITCODE = 0
  & $exe @argList
  if ($LASTEXITCODE -ne 0) { throw "$exe 실패 (종료 코드 $LASTEXITCODE): $($argList -join ' ')" }
}

$name    = 'antigravity-implant'
$src     = Join-Path $PSScriptRoot $name
$plugins = Join-Path $env:USERPROFILE '.gemini\config\plugins'
$dest    = Join-Path $plugins $name
$backups = Join-Path $env:USERPROFILE ".gemini\$name-backups"   # plugins 폴더 밖 (앱이 플러그인으로 읽지 않게)
$cli     = Join-Path $env:USERPROFILE '.gemini\antigravity-cli\settings.json'
$jsonEdit = Join-Path $PSScriptRoot 'tools\json-edit.mjs'
$geminiMdFile = Join-Path $env:USERPROFILE '.gemini\GEMINI.md'
$appCfg       = Join-Path $env:USERPROFILE '.gemini\config\config.json'
$implantCfg   = Join-Path $env:USERPROFILE ".gemini\$name\config.json"
$geminiMdTool = Join-Path $PSScriptRoot 'tools\gemini-md.mjs'
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node 가 필요합니다 (18 이상). https://nodejs.org 에서 설치하세요.' }
$nodeMajor = [int]((node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 18) { throw "node 18 이상이 필요합니다 (지금 $nodeMajor)." }

if ($Uninstall) {
  if (Test-Path -LiteralPath $dest) {
    New-Item -ItemType Directory -Force -Path $backups | Out-Null
    $bak = Join-Path $backups "removed-$stamp"
    [IO.Directory]::Move($dest, $bak)   # 한 번에 이름만 바꿈 (잠긴 파일이 있으면 통째로 실패 — 반쯤 옮겨지지 않게)
    Write-Host "제거: 플러그인 폴더를 $bak 로 옮겼습니다. 필요 없으면 직접 지우세요."
  } else { Write-Host '설치돼 있지 않습니다.' }
  if (Test-Path -LiteralPath $cli) { Invoke-Native node @($jsonEdit, 'remove-statusline', $cli, $name) }
  if (Test-Path -LiteralPath $geminiMdFile) { Invoke-Native node @($geminiMdTool, 'remove', $geminiMdFile) }
  Write-Host "데이터(체크포인트·설정)는 $env:USERPROFILE\.gemini\$name 에 남아 있습니다."
  exit 0
}

if (-not (Test-Path -LiteralPath (Join-Path $src 'plugin.json'))) { throw "플러그인 원본이 없습니다: $src" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Warning 'git 이 없어 체크포인트·되돌리기·변경 보기는 꺼집니다.' }

# 1) 임시 폴더에 복사하고 검증
$stage = Join-Path $env:TEMP "$name-stage-$stamp"
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $stage -Recurse -Force
Get-ChildItem -LiteralPath $stage -Recurse -Filter *.mjs | ForEach-Object { Invoke-Native node @('--check', $_.FullName) }
if (Get-Command agy -ErrorAction SilentlyContinue) { Invoke-Native agy @('plugin', 'validate', $stage, '--strict') }
else { Write-Warning 'agy CLI 가 없어 플러그인 검증을 건너뜁니다 (앱만 써도 플러그인은 동작합니다).' }

# 2) 이전 설치본을 plugins 밖으로 옮기고 새 것을 넣는다. 실패하면 되돌린다.
$old = $null
if (Test-Path -LiteralPath $dest) {
  New-Item -ItemType Directory -Force -Path $backups | Out-Null
  $old = Join-Path $backups "previous-$stamp"
  try { [IO.Directory]::Move($dest, $old) } catch { throw "이전 설치본을 옮길 수 없습니다(Antigravity 앱이 패널을 쓰는 중일 수 있음). 앱을 끄고 다시 실행하세요: $($_.Exception.Message)" }
}
try {
  New-Item -ItemType Directory -Force -Path $plugins | Out-Null
  Copy-Item -LiteralPath $stage -Destination $dest -Recurse -Force
  if (-not (Test-Path -LiteralPath (Join-Path $dest 'plugin.json'))) { throw '복사 후 plugin.json 이 없습니다' }
} catch {
  Write-Warning "설치 실패, 이전 상태로 되돌립니다: $($_.Exception.Message)"
  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
  if ($old) { [IO.Directory]::Move($old, $dest) }
  throw
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "설치: $dest"
if ($old) { Write-Host "이전 설치본: $old (확인 후 지워도 됩니다)" }

# 3) (선택) CLI 상태줄
if ($StatusLine) { Invoke-Native node @($jsonEdit, 'set-statusline', $cli, (Join-Path $dest 'cli\statusline.mjs')) }

# 4) (선택) GEMINI.md 읽기 쉬운 답 규칙
if ($ReadableReplies) {
  $osLocale = ''
  try { $osLocale = [System.Globalization.CultureInfo]::CurrentUICulture.Name } catch {}
  $langArg = if ([string]::IsNullOrWhiteSpace($Lang)) { 'auto' } else { $Lang }
  Invoke-Native node @($geminiMdTool, 'set', $geminiMdFile, '--lang', $langArg, '--locale', $osLocale, '--app-config', $appCfg, '--implant-config', $implantCfg)
}

Write-Host ''
Write-Host '다음:'
Write-Host '  1) Antigravity 앱을 다시 시작하세요 (훅·스킬은 새 대화부터 적용).'
Write-Host '  2) 패널: 대화 화면 오른쪽 패널의 + -> Extensions -> Live Cockpit (대화마다 한 번)'
Write-Host "  3) 점검: 새 대화에서 /doctor  (또는 node `"$dest\cli\doctor.mjs`")"
