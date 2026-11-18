# Antigravity Implant

Google Antigravity 에이전트를 **Claude Code · Codex 처럼** 쓰게 만드는 플러그인입니다.
말없이 도구만 돌리던 에이전트가 일하면서 말하고, 질문에 먼저 답하고, 중간 증거를 보여주고, 끝낼 때 무엇을 확인했는지 말합니다. 파일 체크포인트·되돌리기, 위험 명령 차단, 고친 파일 문법 검사, 실시간 규칙, 옆 패널(Live Cockpit)도 들어 있습니다.

> Windows 에서 만들고 시험했습니다 (Antigravity 앱 2.31, agy CLI 1.5.8). 훅·스킬은 다른 OS 에서도 돌 수 있게 짰지만 시험하지 않았습니다.

## 무엇이 달라지나

| 불편 | Antigravity Implant 가 하는 일 | 방식 |
|---|---|---|
| 말없이 일한다 | 도구를 부르기 전 `NN% 순조롭게 진행중입니다` + 할 일 한 문장. 말없이 도구만 2번 이어지면 더 세게 상기 | 훅 `PreInvocation` + 규칙 |
| 중간 증거가 없다 | 스크린샷·이미지를 만든 직후 "보여줘라" 알림. 패널에 스크린샷이 실시간으로 쌓임 | 훅 + `evidence-checkpoint` + 패널 |
| 도중에 고친 `GEMINI.md`·`AGENTS.md` 가 반영 안 된다 | 사용자가 작업 도중 고치면 다음 모델 호출에 새 내용을 바로 넣음. 패널 「실시간 규칙」은 저장 즉시 매 호출 적용 | 훅 |
| 작업 중 말을 안 듣는다 | 도중에 온 메시지에 먼저 반응하게 함. 패널에서 메시지 보내기, ⏸ 일시정지 | 훅 + 패널 |
| 끝났다면서 확인을 안 한다 | 파일을 고쳤는데 무엇을 확인했는지 없으면 한 번만 마무리를 다시 쓰게 함. 프로젝트 검증 명령을 정해 두면 그걸 돌리게 함 | 훅 `Stop` |
| "…하겠습니다" 하고 끝낸다 | 말한 일을 하거나, 못 하면 이유를 말하게 함(한 번만) | 훅 `Stop` |
| 같은 파일·명령을 반복한다 | 반복·연속 오류·같은 실패·기록 압축 직후를 감지해 방법을 바꾸게 함 | 훅 |
| 대화가 커져 앞 내용을 잊는다 | 85k / 105k 토큰에서 정리·넘겨주기 안내 | 훅 + 상태줄 |
| 잘못 고친 걸 되돌릴 수 없다 | 메시지마다 작업 폴더(git) 자동 체크포인트 → `/rewind` 또는 패널에서 되돌리기·취소. 되돌린 뒤 에이전트에게 "파일이 바뀌었다"고 알림 | 훅 + 스킬 + 패널 |
| 위험한 명령을 그냥 돌린다 | 드라이브 통째 삭제·포맷 등은 항상 차단, 강제 푸시·`reset --hard`·레지스트리·인터넷 스크립트 바로 실행 등은 사용자가 그 일을 말했을 때만 통과 | 훅 `PreToolUse`(run_command 만) |
| 문법 오류를 모르고 지나간다 | `.js/.mjs/.cjs/.json/.py` 를 고친 직후 문법 검사 → 오류면 다음 호출에 알림 | 훅 `PostToolUse` |
| 작업 폴더 밖 파일마다 권한을 묻는다 | 한 번 허락해 읽거나 쓴 파일의 **폴더**를 기억해 다음부터 묻지 않음 (드라이브 맨 위, 사용자 폴더 바로 아래(문서·바탕화면·다운로드 …), 시스템 폴더, 숨김 폴더는 제외. 폴더 목록 보기만으로는 기억하지 않음) | 훅 `PostToolUse` |
| 무엇을 하는지 안 보인다 | 패널: 진행 / 계획(task.md) / 증거 / 변경(git diff) / 되돌리기 / 실시간 규칙 / 훅 기록, 토큰 사용량, 모드 전환 | 사이드카 |

## Claude Code · Codex 에서 쓰던 것 → 여기서는

| Claude Code / Codex | Antigravity + Implant |
|---|---|
| 도구 전 짧은 설명, 단계마다 진행 보고 | 자동 |
| TodoWrite / plan | 자동 `task.md` 체크리스트, 패널 「계획」 |
| plan 모드 | `/plan-first` 또는 `agy --mode plan` |
| `/review` | `/code-review` |
| `/rewind`, Codex undo | 자동 체크포인트 + `/rewind` 또는 패널 「되돌리기」 |
| `/memory`, `#` | `/remember` (경로별 규칙은 `.agents/rules/*.md` 의 `trigger: glob`) |
| `/init` | `/init-project` |
| `/compact`, 이어하기 | `/handoff` → 새 대화에서 `/handoff 이어서` |
| 커밋 / PR | `/commit`, `/pr` |
| `--worktree` | `/worktree` |
| `/doctor` | `/doctor` |
| `/cost` | 패널의 토큰 칩 |
| 출력 스타일 | 패널의 모드: 표준 / 간결 / 엄격 |
| 권한 deny 규칙 | 위험 명령 차단 훅 |
| 고친 뒤 자동 검사 | 문법 검사 훅, `.agents/verify-command` |
| Esc 로 중단 | 패널 ⏸ 일시정지 (다음 모델 호출 전에 멈춤) |
| 상태줄 | agy CLI 상태줄 |
| computer use | `/computer-use` (선택 설치) |

## 들어 있는 것

```
antigravity-implant/
├── plugin.json
├── hooks.json             PreInvocation · Stop · PreToolUse(run_command) · PostToolUse 2개
├── hooks/
│   ├── pre_invocation.mjs 모델 호출 직전 알림 (소통·조향·질문·반복·컨텍스트·규칙 변경·실시간 규칙·문법 오류·되돌림)
│   ├── stop_gate.mjs      마무리 점검·조기 종료 감지
│   ├── danger_guard.mjs   위험 명령 차단 (node 내장 모듈만, 무슨 일이 있어도 JSON 을 냄)
│   ├── syntax_check.mjs   고친 파일 문법 검사
│   ├── folder_grants.mjs  폴더 단위 허락 기억
│   └── checkpoint_worker.mjs, lib/
├── rules/AGENTS.md        상시 규칙 8개
├── skills/                evidence-checkpoint, status-report, plan-first, code-review, computer-use, rewind,
│                          remember, init-project, handoff, commit, pr, worktree, doctor
├── sidecars/live-cockpit  앱 옆 패널
└── cli/                   rewind.mjs, statusline.mjs, doctor.mjs
```

데이터는 `~/.gemini/antigravity-implant/` 에만 씁니다 (대화별 상태, 체크포인트 목록, 오류 로그, 일시정지 신호).
예전 이름 `~/.gemini/agy-communicator/` 가 있으면 처음 돌 때 자동으로 옮깁니다.

## 설치

저장소 맨 위의 `install.ps1` 을 쓰거나, 이 폴더를 `%USERPROFILE%\.gemini\config\plugins\antigravity-implant\` 로 복사하면 됩니다. 필요: node 18 이상, (체크포인트용) git.

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -StatusLine
```

그다음 앱을 다시 시작하고, 대화 화면 오른쪽 패널의 **`+` → Extensions → Live Cockpit** 으로 엽니다(대화마다 한 번). 처음 한 번은 왼쪽 **Customizations → antigravity-implant → UI extensions → Live Cockpit** 에서 Running 인지 확인하세요. 새 대화에서 "이 폴더 파일 3개를 읽고 요약해줘" 라고 보내 보세요. 도구마다 진행률 한 줄이 먼저 나오면 동작하는 것입니다. 점검은 `/doctor`.

- 잠깐 끄기(재시작 없이): `~/.gemini/antigravity-implant/off` 빈 파일을 만들기. 지우면 다시 켜짐
- 끄기/켜기: `agy plugin disable antigravity-implant` / `agy plugin enable antigravity-implant`
- 지우기: `install.ps1 -Uninstall` (데이터 폴더는 남김)

## 설정 (`~/.gemini/antigravity-implant/config.json`, 없으면 기본값)

```json
{
  "remindMode": { "gemini": "always", "claude": "smart", "default": "smart" },
  "silentWarnAfter": 2,
  "stopGate": true,
  "stopRequireVerification": true,
  "verifyCommand": "",
  "dangerGuard": true,
  "syntaxCheck": true,
  "folderGrants": true,
  "folderGrantsFromCommands": false,
  "checkpoints": true
}
```

- `folderGrantsFromCommands` (기본 꺼짐): 켜면 샌드박스 밖 실행(`BypassSandbox`)을 사용자가 허락해 성공한 `run_command` 에서, 명령에 나온 실제 경로(최대 3개)의 폴더에 `write_file(<폴더>\)` 를 넣습니다. 작업 위치(`Cwd`)만으로는 넣지 않습니다. 터미널 샌드박스의 쓰기 범위가 이 규칙을 따르므로(agy CLI 로 확인), 다음부터 그 폴더 작업은 샌드박스 안에서 묻지 않고 됩니다. 경로는 `realpath` 로 진짜 위치를 구한 뒤 판단하고, 폴더 허락과 같은 제외 규칙(드라이브 맨 위·홈·홈 바로 아래·AppData·점 폴더·시스템 폴더·이상한 표기)에 더해 실행 파일·스크립트(`.exe` `.ps1` `.py` 등)가 있는 폴더와 와일드카드 경로는 넓히지 않습니다.
- 폴더 허락(파일 도구) 경로도 진짜 위치로 바꿔 판단합니다. 끝의 점·공백, `~1` 짧은 이름, `:` 데이터 스트림, `\\?\` 접두사가 든 경로는 다른 폴더를 가리킬 수 있어 넓히지 않습니다. 샌드박스 밖 실행 자체를 자동 허락하는 규칙은 없습니다(`unsandboxed(…)` 규칙도 agy CLI 에서 듣지 않음).
- 패널 색은 `~/.gemini/antigravity-implant/ui.json`(`theme`, `accent`)에 저장됩니다. `app` 이면 앱의 `config.json` → `userSettings.themeMode`·`customThemeSeedsDark/Light` 를 읽기만 합니다.

- `remindMode`: `always` 매 호출 / `smart` 새 메시지이거나 말없는 호출이 이어질 때만 / `off`
- `verifyCommand`: 파일을 고친 턴 끝에 마무리 점검이 "한 번 실행하라"고 권할 **내 검증 명령**(예: `npm test`). 작업 폴더의 `.agents/verify-command` 첫 줄은 저장소가 넣은 파일이라 믿지 않고 "후보"로만 보여줍니다 — 에이전트가 평범한 테스트 명령인지 보고, 아니면 사용자에게 묻습니다. 백틱·줄바꿈·`; & | < >` 가 든 명령은 어느 쪽이든 쓰지 않습니다.
- 패널의 「모드」(표준/간결/엄격)는 이 파일의 몇 가지 값을 한 번에 바꿉니다.

## 체크포인트 · 되돌리기

- 메시지를 보낼 때마다 작업 폴더가 git 저장소면 상태를 사진으로 남깁니다(커밋 안 한 변경 + `.gitignore` 안 된 새 파일, 비밀 파일 패턴·5MB 넘는 새 파일 제외). **작업 폴더·인덱스·브랜치는 건드리지 않습니다** (임시 인덱스 + `refs/agyc/…`).
- 되돌리면 그때 있던 파일이 그때 내용으로 돌아가고, 그 뒤 새로 생긴 파일은 지우지 않습니다. 되돌리기 직전 상태도 보관돼 취소할 수 있습니다.
- 명령(PowerShell): `node "$env:USERPROFILE\.gemini\config\plugins\antigravity-implant\cli\rewind.mjs" list latest` (`diff latest N`, `restore latest N`, `undo latest` — 대화 ID 자리에 `latest` 또는 실제 ID 를 꼭 적습니다). 에이전트가 그 대화에서 작업 중이면 되돌리지 않습니다(`--force` 로 강제). cmd 에서는 `"%USERPROFILE%\..."`.
- 저장소 자체 설정(`.git/config`, worktree 설정, include 로 끌어온 설정)에 filter 프로그램·서명(gpg)·include 같은 외부 프로그램 실행 설정이 있으면 그 저장소는 찍지 않습니다(git 이 그 프로그램을 실행할 수 있으므로). 서명과 훅 경로는 항상 강제로 끕니다. 사용자 전역 설정의 git-lfs 등은 괜찮습니다.
- 폴더 허락 규칙은 끝에 `\` 를 붙여 씁니다(`read_file(D:\proj\)`). 앞부분 일치라 `D:\proj` 로 쓰면 `D:\project-x` 까지 허락되기 때문입니다(agy CLI 로 확인).
- 메모리·시간 상한: 작업자는 node 힙 256MB, git 명령 하나당 30초. 새 파일이 5000개를 넘으면 새 파일은 빼고 찍고, 사용자 폴더·드라이브 전체가 저장소면 찍지 않습니다. 시간 초과가 난 저장소는 하루 동안 건너뜁니다(`errors.log` 에 기록). 같은 대화의 작업자는 한 번에 하나만 돕니다.
- 정리: 저장소에서 `git for-each-ref refs/agyc` 로 보고 `git update-ref -d <ref>`.

## 위험 명령 차단

`run_command` 에만 걸리는 `PreToolUse` 훅입니다. Antigravity 의 `PreToolUse` 는 훅이 실패하면 도구를 막는 쪽으로 동작하므로, 이 훅은 node 내장 모듈만 쓰고 어떤 경우에도 `{"decision":"ask"}`(= 평소 권한 그대로) 또는 `deny` 만 냅니다. `allow`(사용자 권한을 건너뜀)는 절대 내지 않습니다.

- 항상 차단: 드라이브·사용자 폴더·시스템 폴더 재귀 삭제, 디스크 포맷·파티션 초기화, `bcdedit`, 섀도 복사본 삭제 등
- 사용자가 이번 메시지에서 그 일을 분명히 말했을 때만 통과: 강제 푸시, `git reset --hard`, `git clean -f`, 레지스트리·영구 환경 변수·서비스·실행 정책 변경, 인터넷에서 받은 스크립트 실행(받아서 바로 실행하거나, 받은 파일을 다음 명령에서 실행 — 사용자가 그 주소를 직접 줬을 때만), 컴퓨터 끄기·재시작, 이 플러그인을 끄는 명령, 풀 수 없는 인코딩 PowerShell 명령
- 명령을 `; && || & |` 와 줄바꿈으로 나눠 조각마다 보고, `cmd /c "…"`·`powershell -c "…"`·`-EncodedCommand` 는 속 명령을 꺼내 다시 봅니다. 따옴표 안의 글(커밋 메시지·검색어)은 명령으로 보지 않습니다. 경로의 `..`·`\?\`·`%SystemDrive%`·`$env:USERPROFILE` 같은 표기도 정리해서 봅니다.
- 한계: 명령 문자열만 봅니다. 스크립트 파일 속에 숨긴 명령이나 파일 편집 도구로 하는 일은 막지 못합니다.
- 끄기: `config.json` 에 `"dangerGuard": false`

## computer use (선택)

데스크톱 앱 조작은 외부 오픈소스 [sandraschi/windows-computer-use-mcp](https://github.com/sandraschi/windows-computer-use-mcp) (MIT) 를 씁니다. 플러그인에 포함하지 않고, 원하는 사람만 `install-computer-use.ps1` 로 따로 설치합니다(고정 커밋, 실행 전 확인 질문, `mcp_config.json` 백업). 키로거·얼굴인식·궤적 기록·클립보드 읽기는 끈 채로 등록합니다. 마우스·키보드 조작은 서버의 승인(`approve_automation`)이 필요하고, 스킬은 에이전트가 스스로 승인하지 않게 합니다.

## 패널(사이드카) 메모

- 패널은 Antigravity 앱이 함께 깔아 주는 `sidecar_sdk` 를 씁니다 (`~/.gemini/config/node_modules/sidecar_sdk`). Google 파일이라 이 저장소에는 넣지 않았습니다.
- 일부 Windows PC(사용자 폴더 이름이 한글 등 ASCII 가 아니고 코드페이지가 UTF-8)에서는 앱이 `"command": "node"` 사이드카를 띄우지 못합니다. 그래서 `sidecar.json` 은 `"node.exe"` 를 씁니다 (PATH 에 node 가 있어야 함).
- 패널의 쓰기 요청(POST)은 토큰이 있어야 받습니다. 앱이 토큰을 주지 않으면 패널이 스스로 무작위 토큰을 만들어 겁니다. `127.0.0.1`/`localhost` 가 아닌 호스트 이름으로 온 요청은 거부합니다(다른 웹사이트가 몰래 요청하거나 DNS rebinding 으로 읽는 것 차단).
- 실시간 규칙은 사용자만 고치는 파일로 봅니다. 에이전트가 명령·서브에이전트를 돌리는 사이에 바뀌었으면(명령으로 고쳤을 수 있으므로) 그 변경은 무시하고, 패널 「훅 기록」에 "무시"로 남깁니다. 그때 직접 저장하신 거라면 한 번 더 저장하면 적용됩니다.
- 패널 서버는 127.0.0.1 에만 열리고, 변경 보기는 훅이 기록한 이 대화의 작업 폴더에서 읽기 전용 git 명령만 씁니다(외부 diff 도구·textconv 끔, UNC 경로 거부).

## 알아 둘 한계

- 도중에 보낸 메시지·일시정지는 **실행 중인 도구를 끊지 않습니다.** 다음 모델 호출 때 적용됩니다.
- `metadata.user_markdown` 은 이 버전에서 훅 출력 전체를 버리게 만들어 쓰지 않습니다.
- swarm 워커·서브에이전트 대화에는 알림(PreInvocation)과 마무리 점검(Stop)을 넣지 않습니다. 위험 명령 차단·문법 검사·폴더 허락 기억은 작업자 대화에서도 돕니다(작업자가 위험한 명령을 돌리는 것도 막아야 하므로). 2차 검사 때 작업자 8명짜리 swarm 을 돌려 방해하지 않는 것을 확인했습니다.
- 앱에서의 동작은 CLI 만큼 시험하지 못했습니다.

## 참고한 오픈소스

| 프로젝트 | 가져온 것 | 라이선스 |
|---|---|---|
| ibsorn/ultragravity | 조기 종료 판정, 성공한 검증 명령 관찰, 오류 서명 (코드는 새로 씀) | MIT |
| wassim-azi/agy-powerline | 상태줄 stdin 1초 마감·EPIPE 무시, 70/90% 색 기준 | MIT |
| wojciehm/antigravity-context-guard | 85k/105k 경고 기준, "늘 때만 다시 알림" (라이선스가 없어 아이디어만) | 없음 |

## 문제가 생기면

- `/doctor` 또는 `node "$env:USERPROFILE\.gemini\config\plugins\antigravity-implant\cli\doctor.mjs"`
- 오류 기록: `~/.gemini/antigravity-implant/errors.log`
- 대화별 훅 상태: `~/.gemini/antigravity-implant/state/<대화ID>.json`
