# Antigravity Implant

[English](README.md) | **한국어**

**Google Antigravity를 Claude Code·Codex처럼 쓰게 만드는 플러그인입니다.** 말없이 도구만 돌리던 에이전트가 일하면서 진행 상황을 말하고, 질문에 먼저 답하고, 중간 증거를 보여주고, 마무리 전 무엇을 확인했는지 보고하며, 다른 세션이나 PC와도 대화를 주고받게 만듭니다. 앱 파일은 전혀 건드리지 않고 플러그인 폴더 하나만 넣으면 됩니다.

## 이런 분께

- 에이전트가 생각(thinking) 창에서만 말하고, 화면에는 도구 호출만 줄줄이 찍혀 답답하신 분
- 작업 도중 `GEMINI.md`를 고쳤는데 턴이 끝날 때까지 반영되지 않아 불편하셨던 분
- Claude Code·Codex의 `/code-review`, `/rewind`, 실시간 작업 목록, 깔끔한 보고서 형식, 세션 간 연결을 쓰고 싶으신 분

## 무엇이 달라지나

| 불편 | Antigravity Implant |
|---|---|
| 말없이 일한다 | 도구를 부르기 전마다 진행률(`NN% …`)과 지금 할 일 한 문장을 먼저 출력 |
| 중간 증거가 없다 | 스크린샷을 찍으면 바로 보여 주도록 알리고, 옆 패널에 캡처를 실시간으로 수집 |
| 도중에 고친 규칙이 안 먹힌다 | 사용자가 고친 `GEMINI.md`·`AGENTS.md`를 다음 모델 호출에 즉시 반영 |
| 작업 중 말을 안 듣는다 | 작업 도중 보낸 메시지에 먼저 반응하고, 패널에서 메시지 전송과 ⏸ 일시정지 지원 |
| 끝났다면서 확인을 안 한다 | 파일을 고쳤는데 확인한 내용이 빠졌으면 한 번만 마무리를 보완하게 요청 |
| 답이 길고 읽기 어렵다 | 선택 옵션 `-ReadableReplies`로 읽기 쉬운 답 10가지 규칙을 사용자 언어에 맞춰 `GEMINI.md`에 자동 추가 |
| 잘못 고친 걸 되돌릴 수 없다 | 메시지마다 git 자동 체크포인트를 남기고 `/rewind`나 패널 버튼으로 복구·취소 |
| 위험한 명령을 그냥 돌린다 | 드라이브 삭제·포맷은 항상 차단, 강제 푸시·`reset --hard`·레지스트리 수정은 직접 지시했을 때만 통과 |
| 문법 오류를 모르고 지나간다 | `.js`·`.mjs`·`.cjs`·`.json`·`.py` 수정 직후 문법을 검사해 오류를 바로 알림 |
| 폴더 밖 파일마다 권한을 묻는다 | 한 번 허락한 파일의 폴더를 기억해 다음부터 묻지 않음 |
| 오토 모드인데 명령마다 묻는다 | 선택 설정을 켜면 허락해 성공한 샌드박스 밖 명령의 폴더에 쓰기 권한을 기억해 다음부터 샌드박스 안에서 통과 |
| 세션끼리 대화가 단절된다 | 세션 메쉬로 같은 PC의 다른 대화나 원격 Windows·Mac 세션끼리 안전하게 메시지 송수신 |
| 패널 색이 앱과 따로 논다 | Live Cockpit이 앱 테마를 실시간으로 따라가며, 테마 9개·강조색 선택과 Gemini 4 주기율표 모델 탐색 탭 제공 |

## 들어 있는 것

| 구성 | 내용 |
|---|---|
| **훅** | 진행 보고 · 작업 중 메시지 우선 · 규칙 변경 즉시 반영 · 반복/막힘 감지 · 컨텍스트 경고(85k/105k) · 마무리/조기 종료 점검 · 위험 명령 차단 · 문법 검사 · 폴더 단위 권한 기억 · 자동 체크포인트 · 세션 메쉬 수신함 전달 |
| **스킬 14개** | `/plan-first` `/code-review` `/rewind` `/remember` `/init-project` `/handoff` `/commit` `/pr` `/worktree` `/doctor` `/status-report` `/computer-use` `/session-mesh` `evidence-checkpoint` |
| **Live Cockpit 패널** | 9개 탭(주기율표 모델 · 진행 · 계획 `task.md` · 증거 · 변경 · 되돌리기 · 실시간 규칙 · 훅 기록 · 세션 메쉬), 토큰 칩, 모드 전환, 앱 테마 실시간 연동, 메시지 보내기, ⏸ 일시정지 |
| **세션 메쉬 (MCP + CLI)** | 내장 `session-bridge` MCP 서버(`mesh_status`, `mesh_list_sessions`, `mesh_send`, `mesh_inbox`, `mesh_sync_now`), CLI 및 수신 데몬(`cli/mesh.mjs`, `cli/mesh-daemon.mjs`), 자체 호스팅 중계 템플릿(`relay/cloudflare-worker`, `relay/node-relay`) |
| **CLI 도구** | 상태줄(`statusline.mjs`), 되돌리기(`rewind.mjs`), 진단(`doctor.mjs`), 세션 메쉬(`mesh.mjs`, `mesh-daemon.mjs`) |

자세한 설명(설정, 체크포인트, 위험 명령 차단, 세션 메쉬, 한계): [antigravity-implant/README.md](antigravity-implant/README.md)

## 설치 (Windows)

필요: [Antigravity](https://antigravity.google), Node.js 18 이상, git(체크포인트용).

```powershell
git clone https://github.com/SEOBLEE101/antigravity-implant.git
cd antigravity-implant
powershell -ExecutionPolicy Bypass -File .\install.ps1 -StatusLine
```

선택 옵션:

```powershell
# 읽기 쉬운 답 10가지 규칙을 ~/.gemini/GEMINI.md 에 사용자 설정·언어에 맞게 자동 번역해 추가
powershell -ExecutionPolicy Bypass -File .\install.ps1 -StatusLine -ReadableReplies

# 언어를 직접 지정할 때 (내장 번역: ko, en, ja, zh-CN, zh-TW, es, fr, de, pt)
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ReadableReplies -Lang ko
```

- 앱을 다시 시작한 뒤 대화 화면 오른쪽 패널의 **`+` → Extensions → Live Cockpit**으로 엽니다(대화마다 한 번). 처음 한 번은 왼쪽 **Customizations → antigravity-implant → UI extensions → Live Cockpit**에서 Running 상태인지 확인하세요.
- 점검: 새 대화에서 `/doctor`
- 제거: `powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall` (데이터 폴더는 남기며, 상태줄 항목과 `-ReadableReplies`로 넣은 `GEMINI.md` 마커 구역을 자동 정리합니다.)

`install.ps1`은 플러그인을 임시 폴더에서 검증한 뒤 `%USERPROFILE%\.gemini\config\plugins\`에 넣기만 합니다. 관리자 권한, 레지스트리, 권한 허용 목록, 외부 다운로드는 건드리지 않습니다. `-StatusLine`은 `agy` CLI 설정을 백업한 뒤 상태줄 한 항목만 추가합니다.

### 읽기 쉬운 답 (`-ReadableReplies`)

옵션을 켜면 `~/.gemini/GEMINI.md`를 바꾸기 전에 `.bak` 파일로 백업하고, 플러그인 전용 주석 마커(`<!-- antigravity-implant:readable-replies:start ... -->`) 사이만 관리합니다. 기존 사용자 규칙은 건드리지 않으며, 이미 같은 제목의 규칙을 직접 적어 두셨다면 중복 추가하지 않고 건너뜁니다.

언어 자동 결정 순서:

1. 설치 명령의 `-Lang` 값
2. `~/.gemini/antigravity-implant/config.json`의 `language` / `locale`
3. Antigravity 앱 `config.json`의 언어 설정
4. 기존 `GEMINI.md` 본문 언어 또는 명시적 응답 언어 지시문
5. `ANTIGRAVITY_LANG`, Windows 표시 언어, `LC_ALL` / `LANG`
6. 영어(`en`) 기본값

9개 언어(`ko`, `en`, `ja`, `zh-CN`, `zh-TW`, `es`, `fr`, `de`, `pt`)는 전용 번역문을 내장하며, 그 밖의 유효한 BCP-47 로캘은 영어 규칙 상단에 해당 언어로 답하라는 한 줄 지시를 붙여 적용합니다.

### 세션 메쉬 (세션·기기 간 대화)

`/session-mesh` 스킬, Live Cockpit 패널의 **세션** 탭, 또는 CLI로 같은 PC의 다른 대화나 원격 Windows·Mac 기기의 Antigravity 세션끼리 메모와 작업 알림을 주고받을 수 있습니다.

- **로컬**: 같은 PC의 세션끼리는 별도 설정 없이 바로 연결됩니다(`toMachine: "local"`).
- **원격 통로 3종** (`http → relay → folder` 순으로 자동 폴백):
  - **Tailscale / LAN HTTP**: 두 기기가 함께 켜져 있을 때 가장 빠르고 실시간 세션 목록 조회를 지원합니다.
  - **클라우드 중계**: Cloudflare Worker(`relay/cloudflare-worker`) 또는 자체 Node 서버(`relay/node-relay`)로 오프라인 큐(7일 보관)를 지원합니다. 자세한 배포 방법은 [antigravity-implant/relay/README.md](antigravity-implant/relay/README.md) 참고.
  - **공유 폴더**: Google Drive 같은 동기화 폴더만으로 별도 데몬 없이 동작합니다.
- **간편 페어링**: `node cli/mesh.mjs init --name win-main --tailscale`(또는 `--folder` / `--relay`)로 초기화한 뒤 `pair-export` 토큰을 반대편 기기에서 `pair-import` 하면 연결됩니다.

### 선택: 데스크톱 앱 조작 (computer use)

외부 오픈소스 [sandraschi/windows-computer-use-mcp](https://github.com/sandraschi/windows-computer-use-mcp) (MIT)를 고정 커밋으로 받아 설치합니다. 기본 설치에는 포함되지 않습니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\install-computer-use.ps1
```

실행 전 확인을 묻고, `mcp_config.json`을 백업한 뒤 서버 하나만 등록합니다(키로거·얼굴인식·궤적 기록·클립보드 읽기 비활성화). 필요: git, [uv](https://docs.astral.sh/uv/).

## 오토 모드에서 덜 묻게 하기

**왜 묻나:** 터미널 명령은 샌드박스 안에서 돌며, 작업 폴더와 허락한 폴더에만 쓸 수 있습니다. 그 밖의 경로가 필요하면 에이전트가 샌드박스 밖 실행(`BypassSandbox`)을 요청하고, 앱은 그 허락을 **명령 전체가 똑같을 때만** 맞는 규칙으로 저장해 다음에도 다시 묻습니다.

**선택 기능(폴더 기억):** `~/.gemini/antigravity-implant/config.json`에 `"folderGrantsFromCommands": true`를 넣으면, 샌드박스 밖 실행을 허락해 성공한 명령에 나온 실제 폴더(명령당 최대 3개)에 `write_file(<폴더>\)` 규칙을 추가합니다. 샌드박스가 이 규칙을 따라 쓰기를 허용하므로 다음부터 그 폴더 작업은 묻지 않고 돕니다. 명령 문자열만으로는 실제 쓰기 위치를 증명할 수 없어 기본은 꺼 두었습니다. 정션·바로가기·짧은 이름으로 실제 위치가 다른 경로는 넓히지 않으며, 드라이브 맨 위, 홈과 바로 아래 폴더, `AppData`, 점(`.`) 폴더, 시스템 폴더, 실행 파일 폴더, 이상한 표기(`~1`, `:` 스트림, `\\?\`, 끝 점·공백)는 제외합니다. 기록은 `~/.gemini/antigravity-implant/folder-grants.json`에 남습니다.

**못 고치는 것:** 샌드박스 안에 아예 없는 도구(예: 외부 브라우저 CLI)는 매번 샌드박스 밖 실행이 필요합니다. 전혀 묻지 않게 하려면 앱의 **설정 → General → Permissions → This Computer → Turbo**를 직접 선택하세요. 보안을 맞바꾸는 선택이라 플러그인이 대신 바꾸지 않습니다.

## 테마와 색 바꾸기

- **Antigravity 앱 본체:** **설정 → Appearance**에서 프리셋 11개(Catppuccin, Dracula, Tokyo Night, Gruvbox Material, One Dark Pro, Solarized Dark 등)와 어두운/밝은 테마별 Background·Foreground·Accent, 대비, 글꼴, 글자 크기를 바꿀 수 있습니다. 앱이 켜져 있으면 `~/.gemini/config/config.json`을 밖에서 고쳐도 반영되지 않으므로 앱 설정 화면에서 변경하세요.
- **Live Cockpit 패널:** 위쪽 **색** 메뉴를 사용합니다. 기본 *앱 따라가기*는 앱 색상을 실시간으로 맞추며, Catppuccin · Dracula · Tokyo Night · Gruvbox · Nord · Solarized Dark · One Dark · GitHub Light · Paper 중 고르고 강조색만 따로 바꿀 수 있습니다. 패널 테마를 고르면 앱 설정 화면에 붙여 넣을 16진수 색상값 세 개도 함께 표시됩니다.

## 안전

- **위험 명령 차단:** `run_command`에만 걸리고 `allow`를 절대 반환하지 않아 사용자 권한 설정이 그대로 유지됩니다. `cmd /c`·`powershell -c`·스크립트 블록·`-EncodedCommand` 안에 숨긴 명령도 풀어서 검사합니다.
- **안전한 체크포인트:** 작업 폴더·인덱스·브랜치를 건드리지 않고, 비밀 파일·큰 파일을 제외하며, 저장소 설정의 filter·서명·훅을 실행하지 않습니다. 메모리·시간 상한이 있습니다.
- **패널·메쉬 보안:** Live Cockpit은 `127.0.0.1`에만 열리고 쓰기 요청에 토큰을 요구하며 외부 Host 헤더를 거부합니다. 세션 메쉬는 피어 메시지를 신뢰 불가 참고 메모로 표시해 시스템 규칙이나 사용자 지시를 덮어쓰지 못하게 하고, 전달 횟수(기본 4)를 제한하며 HTTP 바인딩 기본값을 로컬·Tailscale 사설 IP로 제한합니다.
- **실시간 규칙 보호:** 에이전트가 명령이나 도구를 돌리는 사이에 바뀐 실시간 규칙은 무시합니다.
- **독립 검토:** 다른 모델(Gemini Carbon 오케스트레이터 swarm)로 전체 정적 검사 2회, 보안 자동 검토 3회를 거쳐 지적 사항을 모두 수정했습니다.

## 시험

```powershell
node tests/run-all.mjs
```

8개 시험 묶음, 총 273개 확인 항목. 임시 폴더를 가짜 사용자 폴더로 쓰므로 실제 `~/.gemini`를 건드리지 않습니다. `cockpit-rewind-test`는 앱이 설치해 둔 `sidecar_sdk`가 있어야 하며, 없으면 건너뜁니다.

## 왜 이렇게 만들었나 (실험으로 확인한 것)

- Antigravity 훅 6종(`SessionStart`, `PreInvocation`, `PreToolUse`, `PostToolUse`, `PostInvocation`, `Stop`)이 모두 실제로 동작하며, 훅 1회 실행은 약 0.1초입니다.
- `PreInvocation`의 `ephemeralMessage`는 그 호출에만 적용되고 `systemMessage`는 대화에 남습니다. 따라서 매 호출 알림은 ephemeral로, 규칙 변경·되돌림·메쉬 수신처럼 유지되어야 하는 정보는 `systemMessage`로 전달합니다.
- `PreToolUse`는 실패 시 도구를 차단(fail closed)하고 `allow`는 사용자 권한 설정을 건너뜁니다. 따라서 차단 훅은 `run_command`에만 걸고 기본값은 `ask`로 둡니다.
- `PostToolUse`의 `injectSteps`는 무시되므로 문법 검사 결과는 상태 파일로 넘겨 다음 `PreInvocation`이 알립니다.
- `Stop`의 `decision: "continue"`가 동작하며 두 번째 종료에는 `continuationActive`가 오므로 마무리 점검은 턴당 한 번만 실행됩니다.
- 아무 규칙 없는 Gemini Flash는 거의 항상 설명 없이 도구부터 부르지만, 알림을 넣으면 매번 설명을 먼저 씁니다.

## 한계

- Windows 환경에서만 시험했습니다(Antigravity 앱 2.31, `agy` CLI 1.5.8).
- 작업 도중 보낸 메시지와 일시정지는 실행 중인 도구를 끊지 않고 다음 모델 호출부터 적용됩니다.
- 훅은 찍은 스크린샷을 보여 달라고 알릴 수는 있지만, 모델이 스스로 캡처를 시작하게 강제하지는 못합니다. 찍힌 캡처는 패널 「증거」 탭에 자동으로 모입니다.
- Live Cockpit 패널은 대화마다 오른쪽 패널의 `+` 메뉴에서 한 번 열어야 합니다.

## 라이선스

MIT. 패널이 쓰는 `sidecar_sdk`는 Google이 Antigravity 앱과 함께 배포하는 파일이라 이 저장소에 포함하지 않았습니다(설치된 앱의 것을 그대로 사용). Antigravity는 Google의 상표이며, 이 프로젝트는 Google과 관련이 없습니다.
