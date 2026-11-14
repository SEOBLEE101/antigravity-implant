---
name: worktree
description: >-
  Use this skill when the user explicitly wants a separate git worktree/branch folder so the current checkout stays
  untouched — "따로 브랜치 폴더에서 해봐", "격리해서 작업", "워크트리", "worktree", or /worktree. Planning a risky change
  before editing is the plan-first skill.
  It creates a git worktree on a new branch next to the repo, works there, and at the end shows how to merge
  or delete it, like Claude Code's --worktree and Codex's isolated tasks.
---

# 워크트리에서 따로 작업하기

git worktree = 같은 저장소의 다른 브랜치를 옆 폴더에 하나 더 꺼내 두는 것. 지금 폴더의 파일은 그대로 두고 실험할 수 있다.

## 만들기

1. 저장소 맨 위 폴더를 구한다: `git rev-parse --show-toplevel` (하위 폴더에서 시작했어도 이 경로 기준으로 만든다). 커밋 안 한 변경이 있으면 "새 워크트리에는 커밋된 내용만 들어갑니다"라고 알린다.
2. 이름을 정한다: 브랜치 `agy/<짧은-작업명>`, 폴더는 **저장소 맨 위 폴더의 옆**(같은 부모 폴더) `<저장소이름>-wt-<작업명>` — 절대 경로로 적는다. 저장소 안에 만들지 않는다.
3. 무엇을 만들지(브랜치·절대 경로) 보여주고 승인받은 뒤:

   ```powershell
   git -C "<저장소 맨 위>" worktree add -b agy/<작업명> "<부모 폴더>\<저장소이름>-wt-<작업명>"
   ```

4. 사용자에게 알린다: "이제부터 `<폴더>` 에서 작업합니다. 원래 폴더는 건드리지 않습니다." 이후 모든 파일 경로·명령은 새 폴더 기준(`git -C "<새 폴더>" …` 처럼 폴더를 명시).
   - 알아 둘 것: Antigravity Implant 의 체크포인트·변경 보기·규칙 감시는 **대화의 작업 폴더** 기준이라 새 폴더는 따라가지 않는다. 새 폴더를 작업 폴더로 열어 새 대화를 시작하면 그 기능들도 거기서 동작한다고 알려 준다.

## 끝낼 때

- 결과를 보여주고(바꾼 파일, 확인한 것) 사용자에게 고르게 한다:
  - 합치기: 원래 폴더에서 `git merge agy/<작업명>` (또는 PR — `pr` 스킬)
  - 버리기: `git worktree remove "<폴더>"` 후 `git branch -d agy/<작업명>` (`-d` 는 합쳐지지 않은 커밋이 있으면 거부한다. 그때는 그 커밋 목록을 보여주고, 정말 버릴지 다시 묻고 나서만 `-D`)
  - 그대로 두기
- 버리기·브랜치 삭제는 승인받은 뒤에만. 커밋 안 한 변경이 있으면 먼저 알린다.
- Windows 에서 그 폴더를 터미널·탐색기·편집기가 열고 있으면 `worktree remove` 가 실패한다. 실패하면 닫아 달라고 하고 다시 한다(강제 삭제하지 않는다).

## 알아 둘 것

- `node_modules`, 가상환경 같은 것은 새 폴더에 없다. 필요하면 설치 명령을 새 폴더에서 다시 돌려야 한다고 말한다.
- 목록: `git worktree list`.
