---
name: init-project
description: >-
  Use this skill when the user asks the agent to set up project notes — "AGENTS.md 만들어", "프로젝트 규칙 파일 만들어",
  "init", or /init-project. "프로젝트 파악해" alone means survey and summarize; offer AGENTS.md but ask before creating it.
  It surveys the repo and writes a short AGENTS.md
  (how to run, test, build, structure, conventions, what not to touch), like Claude Code's /init and Codex's /init.
---

# 프로젝트 파악하고 AGENTS.md 만들기 (Claude Code·Codex 의 /init 처럼)

## 순서

1. **훑어보기** (고치지 않음): 최상위 폴더 구조, README, 패키지/빌드 파일(`package.json`, `pyproject.toml`, `Cargo.toml`, `*.sln`, `Makefile` 등), CI 설정, 기존 `AGENTS.md`/`GEMINI.md`/`CLAUDE.md`/`.cursor/rules`.
2. **실제 명령 찾기**: 설치·실행·테스트·빌드·린트 명령을 파일에서 찾아 그대로 옮긴다. 추측한 명령은 쓰지 않는다. 확인 못 한 건 "(확인 필요)" 표시.
3. **AGENTS.md 쓰기** — 이미 있으면 덮어쓰지 말고 바꿀 부분을 diff 로 보여주고 묻는다. 새로 만들 때도 사용자가 「만들어」라고 하지 않았으면 초안을 먼저 보여주고 묻는다. 60줄 안으로:

```markdown
# <프로젝트 이름>

<무엇을 하는 프로젝트인지 2줄>

## 명령
- 설치: …
- 실행: …
- 테스트: …
- 빌드/린트: …

## 구조
- `src/…` — …
- `tests/…` — …

## 규칙
- (코드 스타일, 커밋 메시지, 브랜치 규칙 등 파일에서 확인된 것만)

## 건드리지 말 것
- (생성 파일, 벤더 폴더, 비밀 파일 등)
```

4. 무엇을 확인했고 무엇은 확인 못 했는지 보고한다. AGENTS.md 는 다음 메시지부터 Antigravity 가 자동으로 읽는다.

## 지킬 것

- 짧게. 긴 설명은 링크(README 등)로 대신한다. 상시 규칙 예산(약 2만 토큰)을 아낀다.
- 비밀값·개인 경로·토큰은 쓰지 않는다.
