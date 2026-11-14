---
name: remember
description: >-
  Use this skill when the user wants something remembered across conversations — "기억해", "앞으로는", "항상 이렇게 해",
  "메모해 둬", "remember", or /remember. When the user only corrects the agent, it may offer to remember the
  correction but must ask first. It saves a short, durable rule to a rules file Antigravity loads in every
  conversation, like Claude Code's memory (/memory, # notes).
---

# 기억하기 (Claude Code 의 메모리처럼)

## 어디에 저장하나

| 범위 | 파일 | 언제 |
|---|---|---|
| 모든 프로젝트 | `~/.gemini/config/rules/implant-memory.md` | 사용자 취향·말투·습관 ("항상 한국어로", "진행률 먼저") |
| 이 프로젝트만 | 작업 폴더의 `AGENTS.md` 맨 아래 `## 기억` 절 | 이 프로젝트의 명령·구조·규칙 ("테스트는 npm run t", "src/legacy 는 건드리지 마") |

전역 파일이 없으면 이 머리말로 만든다 (머리말이 없거나 틀리면 Antigravity 가 **경고 없이 무시**한다):

```markdown
---
trigger: always_on
description: 사용자가 /remember 로 저장한 오래 쓸 규칙
---

# 기억
```

### 특정 파일에만 적용할 규칙 (Claude Code 의 경로별 rules 처럼)

"테스트 파일에서는 ○○", "`*.css` 는 ○○"처럼 일부 파일에만 해당하면 작업 폴더의 `.agents/rules/<이름>.md` 에 Antigravity 의 glob 규칙으로 만든다. 그 파일을 다룰 때만 읽혀서 상시 규칙 예산을 아낀다.

```markdown
---
trigger: glob
globs: "**/*.test.ts, tests/**"
description: 테스트 파일 규칙
---

- (규칙 한 줄씩)
```

- glob 규칙은 **작업 폴더의 `.agents/rules/` 에서만** 동작한다(전역 `~/.gemini/config/rules/` 의 glob 규칙은 읽히지 않는다는 보고가 있다).
- 머리말이 틀리면 경고 없이 무시되므로, 만든 뒤 해당 파일을 열었을 때 규칙을 인용할 수 있는지 한 번 확인한다.

## 순서

1. 무엇을 기억할지 한 줄로 정리한다. 명령형, 구체적으로. 예: `- 커밋 메시지는 한국어로 쓴다 (2026-11-14 요청)`.
2. 범위를 정한다(위 표). 애매하면 사용자에게 묻는다.
3. **저장 전에 확인받는다**: "`<한 줄>` 을 `<파일>` 에 저장할까요?" — 사용자가 「기억해」라고 분명히 말했고 범위가 이 프로젝트면 생략해도 된다. 전역 파일은 항상 묻는다.
4. 파일을 읽어 같은 내용이 있으면 새로 쓰지 말고 고친다. 서로 어긋나는 옛 규칙은 지운다.
5. 전역 파일이 3,000자를 넘을 것 같으면, 추가하기 전에 비슷한 줄을 합치거나 오래된 줄을 빼자고 제안한다.
6. 파일에 한 줄을 추가하고, 무엇을 어디에 저장했는지 사용자에게 보여준다.

## 지킬 것

- 한 줄씩, 짧게. 전역 파일은 전체 3,000자 안으로 유지한다(규칙이 길면 Antigravity 가 내용을 빼고 경로만 남긴다).
- 비밀번호·토큰·개인 정보는 저장하지 않는다.
- 이번 대화에서만 쓸 일은 저장하지 않는다.
- 사용자가 "잊어" / "그 규칙 지워"라고 하면 해당 줄을 지운다.
- 저장한 규칙은 다음 메시지부터 적용된다(작업 도중 바로 쓰려면 Live Cockpit 의 「실시간 규칙」).
