---
name: plan-first
description: >-
  Use this skill before any large, risky or ambiguous change — touching several files, refactoring, deleting or
  moving things, changing settings, or when the user says "계획 먼저", "plan first", "바로 하지 말고", or types
  /plan-first. It makes the agent write a reviewable plan and wait for the user's approval before editing anything,
  like Claude Code's plan mode.
---

# 계획 먼저 (Claude Code 의 plan 모드처럼)

## 지금 할 일

1. **아무것도 고치지 않는다.** 파일 읽기·검색처럼 바꾸지 않는 도구만 쓴다. Antigravity 의 `enter_plan_mode` 가 있으면 먼저 켠다.
2. 필요한 만큼만 조사한다(관련 파일, 현재 동작, 제약).
3. 대화 아티팩트 폴더에 `implementation_plan.md` 를 쓴다. ArtifactMetadata: `UserFacing: true`, `RequestFeedback: true`, `Summary`: 한 줄 요약.

## implementation_plan.md 형식

```markdown
# <무엇을 하는가 한 줄>

## 목표
- 끝나면 무엇이 달라지는가 (사용자가 확인할 수 있는 형태로)

## 바꿀 것
| 파일 | 무엇을 | 왜 |
|---|---|---|

## 순서
- [ ] 1. …
- [ ] 2. …

## 확인 방법
- 무엇을 돌리거나 보면 제대로 됐는지 알 수 있나

## 위험 · 되돌리기
- 무엇이 깨질 수 있나, 어떻게 되돌리나

## 결정이 필요한 것
- 선택지가 있으면 추천안과 함께 (없으면 "없음")
```

4. 본문에는 계획을 3~5줄로 요약하고 "이대로 진행할까요?"로 끝낸다. 선택지가 있으면 `ask_question` 으로 묻는다.
5. 사용자가 승인하면 `exit_plan_mode`(있으면) 후 계획의 `순서`를 그대로 `task.md` 체크리스트로 옮기고 진행한다. 계획과 달라지는 일이 생기면 먼저 말한다.

## 하지 말 것

- 승인 전에 파일을 고치거나 명령으로 무언가를 바꾸지 않는다.
- 계획에 없는 일을 "하는 김에" 하지 않는다.
