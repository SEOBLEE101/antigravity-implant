---
name: code-review
description: >-
  Use this skill when the user asks to review changes — "리뷰해줘", "코드 검토", "버그 없나 봐줘", "review",
  or types /code-review. It reviews the uncommitted changes (git diff), or the files, commit or branch the user
  names, for real bugs and reports findings by severity without editing anything, like Claude Code's /review.
---

# 변경 검토 (Claude Code 의 /review 처럼)

새로 고치지 말고 **검토만** 한다. 고치는 건 사용자가 원할 때.

## 순서

1. 무엇을 검토할지 정한다: 사용자가 파일·커밋·브랜치를 말했으면 그것, 아니면 커밋 안 한 변경.
   - `git status --porcelain` 과 `git diff HEAD` (새 파일은 직접 읽기). 아직 커밋이 하나도 없는 저장소는 `git diff HEAD` 가 실패하므로 `git status` 와 파일 읽기로 본다. 터미널을 쓸 수 없으면 바뀐 파일을 읽어서 본다.
   - "PR 리뷰해줘" 처럼 GitHub PR 을 말하면 `gh pr diff <번호>` 로 그 PR 의 변경을 본다(댓글 달기·올리기는 `pr` 스킬, 승인 후에만).
2. 바뀐 부분과, 그 부분을 부르는 코드를 읽는다. 추측으로 판단하지 않는다.
3. 진짜 문제만 찾는다:
   - 틀린 동작(조건 뒤집힘, 경계값, null/빈 값, 예외 처리 빠짐, 비동기 순서)
   - 데이터 손실·보안(비밀값 노출, 입력 검증 없음, 경로 조작)
   - 기존 동작을 깨는 변경(인터페이스·설정 키 바뀜)
   - 테스트가 실제로 아무것도 확인하지 않음
   스타일 취향, 이름 짓기 같은 것은 따로 "사소한 것"에 한두 개만.
4. 가능하면 확인한다: 테스트·린트·타입 검사를 돌릴 수 있으면 돌리고 결과를 인용한다.

## 보고 형식

```
NN% 순조롭게 진행중입니다
검토 범위: (파일 N개, 어떤 변경)

| 심각도 | 파일:줄 | 문제 | 어떤 입력에서 깨지나 | 고치는 방법 |
|---|---|---|---|---|
| 높음 | … | … | … | … |

사소한 것: (있으면 1~2개)
확인한 것: (돌린 테스트·명령과 결과)
확인 못 한 것: (이유)
```

- 문제가 없으면 "찾은 문제 없음"이라고 쓰고, 무엇을 봤는지 적는다. 문제를 지어내지 않는다.
- 마지막에 "고칠까요?"로 묻는다. 묻기 전에 고치지 않는다.
