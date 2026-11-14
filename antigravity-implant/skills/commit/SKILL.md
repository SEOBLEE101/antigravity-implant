---
name: commit
description: >-
  Use this skill when the user asks to commit — "커밋해", "커밋 메시지 써줘", "commit", or /commit. It checks what
  changed, proposes a commit message that follows the repo's style, asks for approval, then commits. It never
  pushes unless the user asks, like Claude Code's commit workflow.
---

# 커밋하기

## 순서

1. 상태 보기: `git status --short`, `git diff --stat`, 필요하면 `git diff`. 최근 메시지 스타일: `git log -5 --oneline`.
2. 위험 확인 — 하나라도 있으면 멈추고 묻는다:
   - 비밀값이 들어간 파일(`.env`, 키, 토큰, `credentials*`)이 포함됨
   - 이번 작업과 상관없어 보이는 파일이 섞임
   - 지금 브랜치가 `main`/`master` 임 → "main 에 바로 커밋합니다. 브랜치를 만들까요?"라고 한 번 묻는다(사용자가 괜찮다고 한 적이 있으면 생략)
3. 커밋 메시지를 제안한다: 저장소의 기존 스타일(언어, 접두어 `feat:` 등)을 따른다. 제목 한 줄 + 필요하면 본문 2~4줄(무엇을, 왜).
4. **어떤 파일을 어떤 메시지로 커밋할지 보여주고 승인받는다.**
5. 승인 후: 필요한 파일만 `git add <파일…>` → `git commit -m "제목" -m "본문 줄1" -m "본문 줄2"` (줄마다 `-m` 하나. PowerShell 에서 따옴표 안 줄바꿈은 깨지기 쉽고, 큰따옴표 안의 `$`·백틱은 바뀌므로 메시지는 작은따옴표로 감싼다. 길면 `$env:TEMP` 아래 UTF-8(BOM 없이) 임시 파일에 쓰고 `git commit -F <파일>` 후 지운다). 결과(커밋 해시, 바뀐 파일 수)를 보여준다.

## 하지 말 것

- `git push`, `--force`, `reset --hard`, `--no-verify`, 서명 건너뛰기는 사용자가 이번에 분명히 시킨 경우에만.
- 훅(pre-commit 등)이 실패하면 우회하지 말고 원인을 보고한다.
- `git add -A` 로 전부 넣지 않는다(위험 확인을 거친 파일만).
