# Antigravity Implant

[English](README.md) | **한국어**

**Google Antigravity 를 Claude Code · Codex 처럼.** 말없이 도구만 돌리던 에이전트가 일하면서 말하고, 질문에 먼저 답하고, 중간 증거를 보여주고, 끝낼 때 무엇을 확인했는지 말하게 만드는 Antigravity 플러그인입니다. 앱 파일은 건드리지 않고, 플러그인 폴더 하나만 넣으면 됩니다.

## 이런 분께

- Antigravity 에이전트가 생각(thinking)에서만 말하고, 화면에는 도구 호출만 줄줄이 찍혀서 답답하신 분
- 작업 도중 `GEMINI.md` 를 고쳤는데 턴이 끝날 때까지 반영되지 않아 곤란하셨던 분
- Claude Code·Codex 의 `/review`, `/rewind`, 할 일 목록, 진행 보고에 익숙하신 분

## 무엇이 달라지나

| 불편 | Antigravity Implant |
|---|---|
| 말없이 일한다 | 도구를 부르기 전마다 `NN% 순조롭게 진행중입니다` + 지금 할 일 한 문장 |
| 중간 증거가 없다 | 스크린샷을 찍으면 "보여줘라" 알림, 옆 패널에 캡처가 실시간으로 쌓임 |
| 도중에 고친 규칙이 안 먹힌다 | 사용자가 고친 `GEMINI.md`·`AGENTS.md` 를 다음 모델 호출에 바로 반영 |
| 작업 중 말을 안 듣는다 | 도중에 온 메시지에 먼저 반응, 패널에서 메시지 보내기·⏸ 일시정지 |
| 끝났다면서 확인을 안 한다 | 파일을 고쳤는데 무엇을 확인했는지 없으면 한 번만 마무리를 다시 쓰게 함 |
| 잘못 고친 걸 되돌릴 수 없다 | 메시지마다 git 자동 체크포인트 → `/rewind` 또는 패널 버튼으로 되돌리기·취소 |
| 위험한 명령을 그냥 돌린다 | 드라이브 통째 삭제·포맷 등은 항상 차단, 강제 푸시 등은 사용자가 말했을 때만 |
| 문법 오류를 모르고 지나간다 | `.js/.json/.py` 를 고친 직후 문법 검사 → 오류면 바로 알림 |
| 폴더 밖 파일마다 권한을 묻는다 | 한 번 허락한 파일의 폴더를 기억해 다음부터 묻지 않음 |

## 들어 있는 것

| | |
|---|---|
| **훅** | 진행 보고 · 작업 중 메시지 우선 · 도중에 고친 규칙 즉시 반영 · 반복/막힘 감지 · 컨텍스트 경고 · 마무리 점검 · 조기 종료 감지 · 위험 명령 차단 · 고친 파일 문법 검사 · 폴더 단위 권한 기억 · 자동 체크포인트 |
| **스킬 13개** | `/plan-first` `/code-review` `/rewind` `/remember` `/init-project` `/handoff` `/commit` `/pr` `/worktree` `/doctor` `/status-report` `/computer-use` `evidence-checkpoint` |
| **Live Cockpit 패널** | 진행 · 계획(task.md) · 스크린샷 · git 변경 · 되돌리기 · 실시간 규칙 · 훅 기록 · 토큰 · 모드 · 메시지 보내기 · ⏸ 일시정지 |
| **CLI** | 상태줄, 되돌리기, 진단 |

자세한 설명(설정, 체크포인트, 위험 명령 차단 규칙, 한계): [antigravity-implant/README.md](antigravity-implant/README.md)

## 설치 (Windows)

필요: [Antigravity](https://antigravity.google), node 18+, git(체크포인트용).

```powershell
git clone https://github.com/SEOBLEE101/antigravity-implant.git
cd antigravity-implant
powershell -ExecutionPolicy Bypass -File .\install.ps1 -StatusLine
```

- 앱을 다시 시작하고, 대화 화면 오른쪽 패널의 **`+` → Extensions → Live Cockpit** 으로 엽니다(대화마다 한 번). 처음 한 번은 왼쪽 **Customizations → antigravity-implant → UI extensions → Live Cockpit** 에서 Running 인지 확인하세요.
- 점검: 새 대화에서 `/doctor`
- 제거: `install.ps1 -Uninstall` (데이터 폴더는 남김)

`install.ps1` 은 플러그인을 임시 폴더에서 검증한 뒤 `%USERPROFILE%\.gemini\config\plugins\` 에 넣기만 합니다. 관리자 권한, 레지스트리, 권한 허용 목록, 외부 다운로드는 건드리지 않습니다. `-StatusLine` 은 agy CLI 설정을 백업한 뒤 상태줄 한 항목만 추가합니다.

### 선택: 데스크톱 앱 조작 (computer use)

외부 오픈소스 [sandraschi/windows-computer-use-mcp](https://github.com/sandraschi/windows-computer-use-mcp) (MIT) 를 고정 커밋으로 받아 설치합니다. 기본 설치에는 들어 있지 않습니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\install-computer-use.ps1
```

실행 전에 확인을 묻고, `mcp_config.json` 을 백업한 뒤 서버 하나만 추가합니다(키로거·얼굴인식·궤적 기록·클립보드 읽기 끔). 필요: git, [uv](https://docs.astral.sh/uv/).

## 안전

- 위험 명령 차단 훅은 `run_command` 에만 걸리고 `allow` 를 절대 내지 않습니다(사용자 권한 설정 그대로). `cmd /c "…"`·`powershell -c "…"`·`-EncodedCommand` 안에 숨긴 명령도 풀어서 봅니다.
- 체크포인트는 작업 폴더·인덱스·브랜치를 건드리지 않고, 비밀 파일·큰 파일은 담지 않으며, 저장소 설정의 filter·서명·훅 프로그램을 실행하지 않습니다. 메모리·시간 상한이 있습니다.
- 패널은 `127.0.0.1` 에만 열리고, 쓰기 요청은 토큰이 있어야 받으며, 다른 호스트 이름으로 온 요청은 거부합니다.
- 실시간 규칙은 에이전트가 명령을 돌리는 사이에 바뀌면 무시합니다(명령으로 바꿨을 수 있으므로).
- 다른 모델(Gemini Carbon 오케스트레이터 swarm)로 전체 정적 검사 2번, 보안 자동 검토 3번을 거쳐 지적 사항을 고쳤습니다.

## 시험

```powershell
node tests/run-all.mjs
```

시험 162개. 임시 폴더를 가짜 사용자 폴더로 써서 실제 설정(`~/.gemini`)을 건드리지 않습니다. `cockpit-rewind-test` 는 앱이 깔아 둔 `sidecar_sdk` 가 있어야 하고, 없으면 건너뜁니다.

## 왜 이렇게 만들었나 (실험으로 확인한 것)

- Antigravity 훅 6종(`SessionStart` `PreInvocation` `PreToolUse` `PostToolUse` `PostInvocation` `Stop`)이 모두 실제로 돈다. 훅 한 번 약 0.1초.
- `PreInvocation` 의 `ephemeralMessage` 는 그 호출에만, `systemMessage` 는 대화에 남는다. → 매 호출 알림은 ephemeral, 규칙 변경처럼 계속 지켜야 하는 것만 systemMessage.
- `PreToolUse` 는 실패하면 도구를 막는다(빈 응답·오류·깨진 출력 모두). `allow` 는 사용자 권한 설정을 건너뛴다. → 차단 훅은 `run_command` 에만, 기본값은 `ask`.
- `PostToolUse` 의 `injectSteps` 는 무시된다. → 문법 검사 결과는 파일로 넘겨 다음 `PreInvocation` 이 알린다.
- `Stop` 의 `decision: "continue"` 는 동작하고, 두 번째 종료 때 `continuationActive` 가 온다. → 마무리 점검은 턴당 한 번.
- 아무 규칙 없는 Gemini Flash 는 거의 항상 글 없이 도구부터 부른다. 알림을 넣으면 매번 설명을 먼저 쓴다.

## 한계

- Windows 에서만 시험했습니다 (Antigravity 앱 2.31, agy CLI 1.5.8).
- 작업 도중 보낸 메시지·일시정지는 실행 중인 도구를 끊지 않고, 다음 모델 호출 때 적용됩니다.
- 훅은 "캡처를 보여줘라"고 알릴 수는 있지만, 모델이 스스로 캡처를 시작하게 강제하지는 못합니다. 찍힌 캡처는 패널 「증거」 탭에 항상 뜹니다.
- 패널은 대화마다 오른쪽 패널의 `+` 메뉴로 한 번 열어야 합니다.

## 라이선스

MIT. 패널이 쓰는 `sidecar_sdk` 는 Google 이 Antigravity 앱과 함께 배포하는 파일이라 이 저장소에 넣지 않았습니다(설치된 앱의 것을 그대로 씀). Antigravity 는 Google 의 상표이며, 이 프로젝트는 Google 과 관련이 없습니다.
