---
name: rewind
description: >-
  Use this skill when the user wants to undo the agent's file changes or go back to how the project was before a
  request — "되돌려", "원래대로", "아까 상태로", "undo", "rewind", or /rewind. Every user request automatically
  checkpoints the workspace git repo (without touching it); this skill lists those checkpoints and restores one,
  like Claude Code's /rewind and Codex's undo.
---

# 되돌리기 (Claude Code 의 /rewind 처럼)

antigravity-implant 는 사용자가 메시지를 보낼 때마다 작업 폴더(git 저장소인 경우)의 상태를 자동으로 사진 찍어 둔다. 작업 폴더·커밋·브랜치는 건드리지 않는다. 이 스킬은 그 사진으로 되돌린다.

**터미널을 못 쓰거나 사용자가 직접 하고 싶으면**: Live Cockpit 패널의 「되돌리기」 탭에서 같은 일을 버튼으로 할 수 있다(두 번 눌러야 실행). 그렇게 안내만 해도 된다.

도구 — PowerShell 기준 (cmd 에서는 `$env:USERPROFILE` 대신 `%USERPROFILE%`, 경로는 꼭 따옴표로):

```powershell
node "$env:USERPROFILE\.gemini\config\plugins\antigravity-implant\cli\rewind.mjs" list <대화ID>
node "$env:USERPROFILE\.gemini\config\plugins\antigravity-implant\cli\rewind.mjs" diff <대화ID> <번호>
node "$env:USERPROFILE\.gemini\config\plugins\antigravity-implant\cli\rewind.mjs" restore <대화ID> <번호>
node "$env:USERPROFILE\.gemini\config\plugins\antigravity-implant\cli\rewind.mjs" undo <대화ID>
```

- `<대화ID>`: 이 대화의 아티팩트 폴더 경로 마지막 부분(…\brain\<대화ID>). 모르면 `latest`.

## 순서

1. `list` 로 체크포인트 목록을 보여준다(시각과 그때의 요청).
2. 사용자가 어느 시점인지 말하지 않았으면 묻는다. 보통 "이번 요청 직전" = 마지막 번호.
3. `diff` 로 그 시점 이후 바뀐 파일을 보여주고, **"이 파일들을 그때 내용으로 되돌릴까요?"라고 확인받는다.**
4. 승인받으면 `restore`. 결과를 그대로 전한다: 되돌린 파일, 지우지 않고 남긴 새 파일.
5. "되돌리기를 취소하려면 `undo`"라고 알려 준다.

## 되돌리기 취소(undo)

`undo` 도 작업 폴더 파일을 덮어쓴다. 바로 실행하지 말고 `list` 로 맨 아래 「되돌리기 직전 상태」의 시각을 보여주고 **"이 시점으로 다시 돌릴까요?"라고 확인받은 뒤** 실행한다.

## 알아 둘 것

- git 저장소가 아닌 폴더, `.gitignore` 된 파일은 체크포인트가 없다. 그럴 땐 그렇다고 말한다.
- 되돌리기 직전 상태도 자동으로 보관되므로 `undo` 로 원래대로 돌릴 수 있다.
- 체크포인트 이후 새로 생긴 파일은 지우지 않는다. 지워야 하면 사용자에게 목록을 보여주고 따로 묻는다.
- 대화 내용(에이전트가 한 말)은 되돌리지 않는다. 파일만이다. 되돌린 뒤 첫 모델 호출 때 훅이 "파일이 예전 내용으로 돌아갔다"는 알림을 한 번 넣어 준다 — 기억 대신 파일을 다시 읽는다.
