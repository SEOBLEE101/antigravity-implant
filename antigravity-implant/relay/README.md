# Antigravity Session Mesh Relay

다른 네트워크에 있거나 한쪽 기기가 오프라인일 때 세션을 연결해 주는 경량 중계 서버입니다.  
Cloudflare Workers(무료 플랜 Durable Objects 지원) 또는 자체 호스팅 Node.js 서버 중 원하는 방식을 선택할 수 있으며, 두 구현 모두 동일한 `/v1/*` API와 HMAC-SHA256 인증 규격을 따릅니다.

---

## 1. Cloudflare Worker 배포

### 사전 준비
- Cloudflare 계정 및 [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) 로그인 (`npx wrangler login`)
- 충분히 긴 공유 비밀키 생성 (예: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

### 배포 절차
```bash
cd relay/cloudflare-worker
npx wrangler secret put MESH_SECRET
# 위에서 만든 64자리 hex 비밀키 입력

npx wrangler deploy
```

> 주의: `wrangler.toml`에는 절대 비밀키(`MESH_SECRET`)를 적지 마세요. 반드시 `wrangler secret put`으로만 등록합니다.

배포 후 출력되는 URL(예: `https://antigravity-mesh-relay.<subdomain>.workers.dev`)을 확인한 뒤 각 기기에서 등록합니다:

```bash
node cli/mesh.mjs init --name win-main --relay "https://antigravity-mesh-relay.<subdomain>.workers.dev" --relay-secret "<비밀키>"
```

---

## 2. 자체 호스팅 Node 중계 (`relay/node-relay/server.mjs`)

외부 의존성이 없는 순수 Node 18+ ESM 서버입니다.

### 환경 변수
- `MESH_SECRET` (필수): 모든 클라이언트와 공유하는 HMAC-SHA256 비밀키. 없으면 오류를 내고 종료합니다.
- `HOST` (기본 `127.0.0.1`): 바인딩 호스트. 공용망 노출 시 반드시 Caddy/Nginx 등 HTTPS 리버스 프록시 뒤에 두고 `127.0.0.1`을 유지하세요.
- `PORT` (기본 `8787`): 리슨 포트.
- `RELAY_DATA_DIR` (선택): 지정하면 `relay-state.json`에 큐와 presence를 영속화합니다. 비워 두면 메모리에서만 동작합니다.

### 실행 예시 (PowerShell)
```powershell
$env:MESH_SECRET = "<64자리_랜덤_hex>"
$env:HOST = "127.0.0.1"
$env:PORT = "8787"
$env:RELAY_DATA_DIR = "$env:USERPROFILE\.gemini\antigravity-implant\relay-data"
node relay/node-relay/server.mjs
```

### 실행 예시 (bash)
```bash
MESH_SECRET="<64자리_랜덤_hex>" HOST="127.0.0.1" PORT=8787 RELAY_DATA_DIR="$HOME/.gemini/antigravity-implant/relay-data" \
  node relay/node-relay/server.mjs
```

---

## 3. API 규격 요약 (`/v1/*`)

`GET /v1/health`를 제외한 모든 엔드포인트는 다음 헤더로 HMAC-SHA256 서명을 검증합니다(±300초 재생 공격 차단).

- `X-Mesh-Timestamp`: 요청 시각(ms/s epoch 또는 ISO 문자열)
- `X-Mesh-Machine`: 요청 머신 ID (`[a-zA-Z0-9._-]{2,48}`)
- `X-Mesh-Signature`: `HMAC-SHA256(secret, "${METHOD}\n${pathname}\n${timestamp}\n${machineId}\n${bodyText}")` hex

| 엔드포인트 | 설명 | 제한/권한 |
|---|---|---|
| `GET /v1/health` | 상태 확인 | 무인증 |
| `POST /v1/send` | `{ envelope }` 큐 적재 | 본문 최대 16KB(초과 시 413), 머신당 최대 200건 / 7일 만료 |
| `GET /v1/pull?machine=<id>&limit=20` | 수신 대기 메시지 조회 | `machine !== X-Mesh-Machine` 이면 403 |
| `POST /v1/ack` | `{ machineId, ids }` 수거 완료 제거 | `body.machineId !== X-Mesh-Machine` 이면 403 |
| `POST /v1/presence` | `{ machineId, displayName, sessions }` 등록 | `body.machineId !== X-Mesh-Machine` 이면 403, 10분 TTL |
| `GET /v1/presence` | 온라인 머신 및 세션 캐시 조회 | 만료 항목 자동 제외 |
