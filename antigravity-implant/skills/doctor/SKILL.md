---
name: doctor
description: >-
  Use this skill when the user asks whether Antigravity Implant itself is working — "임플란트 점검", "플러그인 진단",
  "훅이 도는지 확인", "패널이 안 떠", "상태줄이 안 나와", "doctor", or /doctor. Not for debugging the user's own code
  (that is normal work). It runs a read-only diagnostic of this plugin
  (install, hooks, panel, permissions, status line, computer-use) and explains each problem with its fix,
  like Claude Code's /doctor. It never changes anything.
---

# 진단 (Claude Code 의 /doctor 처럼)

읽기만 하는 점검이다. 고치는 건 사용자가 원할 때만.

## 순서

1. 실행 (PowerShell):

   ```powershell
   node "$env:USERPROFILE\.gemini\config\plugins\antigravity-implant\cli\doctor.mjs"
   ```

   cmd 에서는 `node "%USERPROFILE%\.gemini\config\plugins\antigravity-implant\cli\doctor.mjs"`. 터미널을 못 쓰면 그렇다고 말하고, 사용자에게 위 명령을 직접 실행해 결과를 붙여 달라고 한다.
2. 결과를 그대로 요약한다: `✗ 문제` 와 `! 주의` 만 표로(무엇이 / 왜 중요한지 / 고치는 방법). `✓` 는 개수만.
3. 고칠 것이 있으면 "고칠까요?"라고 묻는다. 권한 규칙 삭제, 앱 설정 변경처럼 되돌리기 어려운 건 사용자가 앱 설정에서 직접 하도록 위치를 알려 준다.

## 하지 말 것

- 점검 중에 설정·파일을 바꾸지 않는다.
- 결과에 나온 경로·명령 외의 원인을 추측으로 단정하지 않는다.
