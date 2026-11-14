---
name: evidence-checkpoint
description: >-
  Use this skill whenever the agent changes something the user can look at — a web page, UI, desktop app
  screen, image, chart, video frame or document — or has just run tests or a build. It shows the user concrete
  evidence in the middle of the work (screenshots, rendered images, diffs, command output) instead of only
  describing it at the end. Reviewing code for bugs is the code-review skill, not this one.
---

# 중간 증거 보여주기

목표: 사용자가 결과를 말로만 듣지 않고 **직접 보게** 한다. 작업 도중 의미 있는 단계마다 한 번.

## 언제

- 화면(웹·앱·UI)을 처음 띄웠을 때, 크게 바꿨을 때, 끝냈다고 말하기 직전
- 이미지·차트·영상 프레임·문서를 만들었을 때
- 파일을 3개 이상 고쳤을 때
- 테스트·빌드·실행을 돌렸을 때

## 어떻게

1. **스크린샷·이미지**
   - 웹: 브라우저 도구(`capture_browser_screenshot`)나 사용자가 정한 브라우저 도구로 찍는다.
   - 데스크톱 앱: `windows-computer-use` MCP 의 `automation_visual` (`{"request": {"operation": "screenshot", "window_handle": <HWND>, "output_path": "<아티팩트 폴더>\\step1.png"}}`) — `computer-use` 스킬 참고.
   - 결과 파일을 **대화 아티팩트 폴더**에 저장하거나 복사한다(서브에이전트 단계 썸네일로만 남기지 않는다).
   - 답에 이미지 링크를 붙이고, 그 아래 한 줄로 무엇을 확인했는지 쓴다. 예: `확인: 로그인 버튼이 오른쪽 위에 보임, 콘솔 오류 없음`.
2. **코드 변경**
   - 바꾼 파일 목록과 파일마다 핵심 변경 한 줄. 길면 가장 중요한 diff 조각 하나(10줄 이내)만.
3. **실행 결과**
   - 돌린 명령과 결과의 핵심 줄(통과/실패 수, 오류 첫 줄)을 그대로 인용한다. 「잘 됐다」로 요약하지 않는다.
4. **표·수치**
   - 숫자 비교가 핵심이면 작은 표로 보여준다.

## 하지 말 것

- 찍지 않은 스크린샷, 돌리지 않은 테스트를 확인했다고 쓰지 않는다. 못 했으면 「확인 못 함: 이유」라고 쓴다.
- 증거를 모아 두었다가 맨 끝에 한꺼번에 보여주지 않는다. 단계마다 보여준다.
- 이미지를 외부 웹 주소로 올리지 않는다. 로컬 아티팩트 폴더만 쓴다.
- 비밀값을 증거에 남기지 않는다: 명령 결과·로그에 토큰·비밀번호·API 키·쿠키가 보이면 `<REDACTED>` 로 바꿔 인용한다. 로그인 화면·개인 정보가 보이는 화면은 찍지 않거나, 찍었으면 사용자에게 알리고 붙이지 않는다.

## 중간 보고 형식 (끝냈다고 말할 때도 같은 모양)

```
NN% 순조롭게 진행중입니다
바꾼 것: …
확인한 것: … (증거: 스크린샷 링크 / 명령 결과)
확인 못 한 것: … (이유)
```
