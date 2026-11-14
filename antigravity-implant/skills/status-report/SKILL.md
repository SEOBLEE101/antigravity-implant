---
name: status-report
description: >-
  Use this skill when the user asks where the agent's work stands — "지금 어디까지 했어", "진행 상황", "상태 보고",
  "work status", "progress status", "what's left" — or types /status-report. Not for `git status`. It gives a
  short, honest progress report from what is already known, then resumes the interrupted task.
---

# 진행 상황 보고

보고 자체를 위해 새 조사·새 작업을 시작하지 않는다. 이미 아는 것(task.md, 지금까지의 결과)으로 짧게 보고한다. 도구는 꼭 필요할 때만(예: 테스트 결과 다시 확인) 쓴다.

형식:

```
NN% 순조롭게 진행중입니다   (막혔으면 NN% 문제를 해결중입니다)

| 단계 | 상태 | 비고 |
|---|---|---|
| … | 완료 / 진행중 / 남음 / 막힘 | 증거나 이유 한 줄 |

지금 하던 일: 한 문장
다음 할 일: 한 문장
사용자가 정해 줘야 할 것: 있으면 하나 (없으면 생략)
```

- 퍼센트는 표의 완료 단계 수로 계산한다(예: 5단계 중 3개 완료 → 60%).
- 확인하지 않은 것은 「완료」로 쓰지 않는다.
- 작업 도중 물어본 것이면: 보고한 뒤 하던 작업을 이어간다(사용자가 멈추라고 했으면 멈춘다).
- 작업이 없거나 끝난 뒤 물어본 것이면: 보고만 하고 끝낸다.
