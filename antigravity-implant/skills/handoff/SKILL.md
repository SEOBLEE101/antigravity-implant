---
name: handoff
description: >-
  Use this skill when the conversation is getting long or about to be compressed (the hook says 컨텍스트 위험),
  when the user wants to continue in a fresh conversation — "정리해서 넘겨", "새 대화에서 이어서 하게 정리해",
  "handoff", "compact", /handoff — or when a new conversation starts with "handoff 이어서" / "/handoff 이어서".
  A bare "이어서" alone is NOT a trigger (that usually means "keep going"). It saves or loads a compact,
  per-project hand-off note, like Claude Code's /compact and session resume.
---

# 넘겨주기 (Claude Code 의 /compact·이어하기처럼)

긴 대화는 자동 압축되면서 앞 내용을 잊는다. 그 전에 핵심만 파일로 남기고 새 대화에서 이어간다.

## 어디에

- **프로젝트별**: 작업 폴더의 `.agents/handoff.md` (폴더가 없으면 만든다). 여러 프로젝트를 오가도 서로 덮어쓰지 않는다.
- 작업 폴더가 없는 대화(일반 질문 등)만 `~/.gemini/antigravity-implant/handoff/latest.md`.
- 같은 내용을 대화 아티팩트 폴더에도 `handoff.md` 로 남긴다(ArtifactMetadata `UserFacing: true`).
- 작업 폴더가 git 저장소면 `.agents/handoff.md` 를 커밋하지 않는다(사용자가 원하면 `.gitignore` 에 넣자고 제안).

## 저장할 때

```markdown
# 넘겨주기 — <작업 이름> (<날짜 시각>)

## 목표
- 사용자가 원하는 최종 결과 한두 줄

## 지금까지 한 것
- [x] …  (파일·명령·결과 근거)

## 남은 것
- [ ] …  (다음에 할 첫 단계를 맨 위에)

## 중요한 사실
- 결정된 것, 알아낸 제약, 실패한 방법과 이유

## 바뀐 파일
- `경로` — 무엇을

## 이어갈 때 먼저 할 일
- 한 문장
```

- 60줄 안으로. 대화를 다시 읽지 않아도 이어갈 수 있게, 구체적인 경로와 명령으로.
- **비밀값(비밀번호·토큰·API 키·쿠키·개인 정보)은 쓰지 않는다.** 필요하면 "어디에 있는지"만 적는다.
- 저장 후 사용자에게: "이 프로젝트 폴더에서 새 대화를 열고 `/handoff 이어서`라고 보내면 이어집니다."

## 불러올 때 ("handoff 이어서", "/handoff 이어서")

1. 작업 폴더의 `.agents/handoff.md` 를 읽는다(없으면 `~/.gemini/antigravity-implant/handoff/latest.md`). 둘 다 없으면 그렇다고 말한다.
2. 3줄로 요약해 사용자에게 보여주고("여기까지 했고, 다음은 ○○입니다"), `남은 것` 을 `task.md` 체크리스트로 옮긴다.
3. 바뀐 파일 중 필요한 것만 다시 읽고 `이어갈 때 먼저 할 일` 부터 시작한다.
