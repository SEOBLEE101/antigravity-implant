# Antigravity Implant

**Google Antigravity 를 Claude Code · Codex 처럼.** 말없이 일하던 에이전트가 일하면서 말하고, 질문에 먼저 답하고, 중간 증거를 보여주고, 끝낼 때 무엇을 확인했는지 말하게 만드는 Antigravity 플러그인입니다.

*Makes the Google Antigravity agent behave more like Claude Code / Codex: progress notes before tool calls, questions answered first, mid-task evidence, wrap-up checks, live rules, file checkpoints & rewind, a dangerous-command guard, post-edit syntax checks and a live side panel. Korean-first docs; hooks and skills are plain Node.js and Markdown.*

| | |
|---|---|
| 훅 | 진행 보고 강제 · 작업 중 메시지 우선 · 도중에 고친 규칙 즉시 반영 · 반복/막힘 감지 · 컨텍스트 경고 · 마무리 점검 · 조기 종료 감지 · 위험 명령 차단 · 고친 파일 문법 검사 · 폴더 단위 권한 기억 · 자동 체크포인트 |
| 스킬 | `/plan-first` `/code-review` `/rewind` `/remember` `/init-project` `/handoff` `/commit` `/pr` `/worktree` `/doctor` `/status-report` `/computer-use` `evidence-checkpoint` |
| 패널 (Live Cockpit) | 진행 · 계획(task.md) · 스크린샷 · git 변경 · 되돌리기 · 실시간 규칙 · 훅 기록 · 토큰 · 모드 · 메시지 보내기 · ⏸ 일시정지 |
| CLI | 상태줄, 되돌리기, 진단 |

자세한 설명: [antigravity-implant/README.md](antigravity-implant/README.md)

## 설치 (Windows)

필요: [Antigravity](https://antigravity.google), node 18+, git(체크포인트용).

```powershell
git clone https://github.com/SEOBLEE101/antigravity-implant.git
cd antigravity-implant
powershell -ExecutionPolicy Bypass -File .\install.ps1 -StatusLine
```

- 앱을 다시 시작하고, 패널 메뉴에서 **Live Cockpit** 을 켭니다.
- 점검: 새 대화에서 `/doctor`
- 제거: `install.ps1 -Uninstall`

`install.ps1` 은 플러그인 폴더를 `%USERPROFILE%\.gemini\config\plugins\` 에 복사하고 검증만 합니다. 관리자 권한, 레지스트리, 권한 허용 목록, 외부 다운로드는 건드리지 않습니다. `-StatusLine` 은 agy CLI 설정을 백업한 뒤 상태줄 한 항목만 추가합니다.

### 선택: 데스크톱 앱 조작 (computer use)

외부 오픈소스 [sandraschi/windows-computer-use-mcp](https://github.com/sandraschi/windows-computer-use-mcp) (MIT) 를 고정 커밋으로 받아 설치합니다. 기본 설치에는 들어 있지 않습니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\install-computer-use.ps1
```

실행 전에 확인을 묻고, `mcp_config.json` 을 백업한 뒤 서버 하나만 추가합니다(키로거·얼굴인식·궤적 기록·클립보드 읽기 끔). 필요: git, [uv](https://docs.astral.sh/uv/).

## 시험

```powershell
node tests/run-all.mjs
```

시험은 임시 폴더를 가짜 사용자 폴더로 써서 실제 설정(`~/.gemini`)을 건드리지 않습니다. `cockpit-rewind-test` 는 앱이 깔아 둔 `sidecar_sdk` 가 있어야 하고, 없으면 건너뜁니다.

## 왜 이렇게 만들었나 (실험으로 확인한 것)

- Antigravity 훅 6종(`SessionStart` `PreInvocation` `PreToolUse` `PostToolUse` `PostInvocation` `Stop`)이 모두 실제로 돈다. 훅 한 번 약 0.1초.
- `PreInvocation` 의 `ephemeralMessage` 는 그 호출에만, `systemMessage` 는 대화에 남는다. → 매 호출 알림은 ephemeral, 규칙 변경처럼 계속 지켜야 하는 것만 systemMessage.
- `PreToolUse` 는 실패하면 도구를 막는다(빈 응답·오류·깨진 출력 모두). `allow` 는 사용자 권한 설정을 건너뛴다. → 차단 훅은 `run_command` 에만, 기본값은 `ask`.
- `PostToolUse` 의 `injectSteps` 는 무시된다. → 문법 검사 결과는 파일로 넘겨 다음 `PreInvocation` 이 알린다.
- `Stop` 의 `decision: "continue"` 는 동작하고, 두 번째 종료 때 `continuationActive` 가 온다. → 마무리 점검은 턴당 한 번.
- 아무 규칙 없는 Gemini Flash 는 거의 항상 글 없이 도구부터 부른다. 알림을 넣으면 매번 설명을 먼저 쓴다.

## 라이선스

MIT. 패널이 쓰는 `sidecar_sdk` 는 Google 이 Antigravity 앱과 함께 배포하는 파일이라 이 저장소에 넣지 않았습니다(설치된 앱의 것을 그대로 씀). Antigravity 는 Google 의 상표이며, 이 프로젝트는 Google 과 관련이 없습니다.
