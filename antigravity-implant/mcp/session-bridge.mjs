// antigravity-implant 세션 메쉬 stdio MCP 브리지 서버 (Node 18+ 제로 의존성 ESM).
// 주의: stdout 은 오직 JSON-RPC 2.0 응답 전용. console.log 사용 금지(로그는 stderr 로).
import {
  getMeshStatus,
  listAllSessions,
  sendMessage,
  drainInboxForConversation,
  readHistory,
  syncAllTransports,
} from '../hooks/lib/mesh.mjs';

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const TOOLS = [
  {
    name: 'mesh_status',
    description: '현재 머신의 세션 메쉬 신원(machineId), 전송 통로 설정(비밀값 마스킹), 데몬 상태, 대기 중 수신/깨우기 큐 건수를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'mesh_list_sessions',
    description: '로컬 및 원격 머신(Tailscale/공유 폴더/클라우드 중계로 동기화된 피어)의 Antigravity 세션 목록을 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        machine: {
          type: 'string',
          description: '특정 머신 필터 ("local" 또는 원격 machineId). 생략하면 전체 머신.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: '반환할 최대 세션 수 (기본 40)',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'mesh_send',
    description: '다른 로컬 세션 또는 원격 머신의 Antigravity 세션에 메시지를 보냅니다. 원격 전송은 auto 모드에서 http -> relay -> folder 순으로 폴백합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        toMachine: {
          type: 'string',
          description: '대상 머신 ID 또는 "local"',
        },
        toConversationId: {
          type: 'string',
          description: '대상 대화 UUID, "latest"(최근 메인 세션), 또는 "*"(아무 활성 세션). 기본값 "latest".',
        },
        fromConversationId: {
          type: 'string',
          description: '보내는 세션의 대화 ID (선택)',
        },
        fromTitle: {
          type: 'string',
          description: '보내는 세션 제목 (선택)',
        },
        subject: {
          type: 'string',
          description: '짧은 메시지 제목 (최대 120자, 선택)',
        },
        body: {
          type: 'string',
          description: '메시지 본문 (최대 4000자)',
        },
        kind: {
          type: 'string',
          enum: ['note', 'request', 'reply', 'ping'],
          description: '메시지 종류 (기본 "note")',
        },
        threadId: {
          type: 'string',
          description: '기존 스레드를 이어갈 때 사용하는 스레드 ID (선택)',
        },
        hop: {
          type: 'integer',
          minimum: 1,
          description: '전달 홉 수 (루프 방지용, 기본 1)',
        },
        wake: {
          type: 'boolean',
          description: '대상 세션이 유휴 상태일 때 깨우기 큐에 넣을지 여부 (기본 true)',
        },
        transport: {
          type: 'string',
          enum: ['auto', 'local', 'http', 'relay', 'folder'],
          description: '전송 통로 지정 (기본 "auto")',
        },
      },
      required: ['toMachine', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'mesh_inbox',
    description: '지정한 conversationId 의 수신함을 수거하거나 최근 메쉬 송수신 이력을 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: {
          type: 'string',
          description: '특정 대화 ID (지정 시 해당 대화의 대기 수신함을 수거하거나 이력을 필터링)',
        },
        drain: {
          type: 'boolean',
          description: 'conversationId 지정 시 대기 수신함을 실제로 수거할지 여부 (기본 true)',
        },
        direction: {
          type: 'string',
          enum: ['in', 'out'],
          description: '이력 방향 필터 ("in" 또는 "out")',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: '조회/수거 최대 개수 (기본 20)',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'mesh_sync_now',
    description: '활성화된 모든 전송 통로(HTTP 피어, 공유 폴더, 클라우드 중계)에 현재 세션을 알리고 새 메시지와 피어 세션을 즉시 동기화합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

function sendJsonRpc(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendResult(id, result) {
  sendJsonRpc({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  sendJsonRpc({ jsonrpc: '2.0', id: id ?? null, error: err });
}

async function runTool(name, args) {
  const a = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'mesh_status':
      return { data: getMeshStatus(), isError: false };
    case 'mesh_list_sessions': {
      const lim = Math.min(Math.max(1, Number(a.limit) || 40), 100);
      const sessions = listAllSessions({ machine: a.machine }).slice(0, lim);
      return { data: { count: sessions.length, sessions }, isError: false };
    }
    case 'mesh_send': {
      const res = await sendMessage({
        toMachine: a.toMachine,
        toConversationId: a.toConversationId || 'latest',
        fromConversationId: a.fromConversationId || '',
        fromTitle: a.fromTitle || '',
        subject: a.subject || '',
        body: a.body,
        kind: a.kind || 'note',
        threadId: a.threadId,
        hop: a.hop ?? 1,
        wake: a.wake !== false,
        transport: a.transport || 'auto',
      });
      return { data: res, isError: !res.ok };
    }
    case 'mesh_inbox': {
      const lim = Math.min(Math.max(1, Number(a.limit) || 20), 100);
      let drained = null;
      if (a.conversationId && a.drain !== false) {
        drained = drainInboxForConversation(a.conversationId, { maxMessages: Math.min(lim, 20) });
      }
      const history = readHistory({
        conversationId: a.conversationId,
        direction: a.direction,
        limit: lim,
      });
      return {
        data: {
          ...(drained ? { drained: drained.messages, promptText: drained.promptText } : {}),
          history,
        },
        isError: false,
      };
    }
    case 'mesh_sync_now': {
      const res = await syncAllTransports();
      return { data: res, isError: !res.ok };
    }
    default:
      return null;
  }
}

async function handleRequest(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) {
    sendError(null, -32600, 'Invalid Request');
    return;
  }
  const hasId = req.id !== undefined && req.id !== null;
  const method = req.method;

  if (typeof method !== 'string') {
    if (hasId) sendError(req.id, -32600, 'Invalid Request: missing method');
    return;
  }

  // 알림(id 없음)은 응답하지 않는다
  if (method === 'notifications/initialized' || method === 'initialized') {
    if (hasId) sendResult(req.id, {});
    return;
  }

  if (method === 'initialize') {
    const clientVer = String(req.params?.protocolVersion || '');
    const protocolVersion = SUPPORTED_PROTOCOLS.includes(clientVer) ? clientVer : '2024-11-05';
    sendResult(req.id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'session-bridge', version: '1.0.0' },
    });
    return;
  }

  if (method === 'ping') {
    if (hasId) sendResult(req.id, {});
    return;
  }

  if (method === 'tools/list') {
    sendResult(req.id, { tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    const toolName = req.params?.name;
    const toolArgs = req.params?.arguments;
    try {
      const out = await runTool(toolName, toolArgs);
      if (!out) {
        if (hasId) sendError(req.id, -32602, `Unknown tool: ${String(toolName || '')}`);
        return;
      }
      if (hasId) {
        sendResult(req.id, {
          content: [{ type: 'text', text: JSON.stringify(out.data, null, 2) }],
          isError: Boolean(out.isError),
        });
      }
    } catch (e) {
      if (hasId) {
        sendResult(req.id, {
          content: [{ type: 'text', text: e?.message || String(e) }],
          isError: true,
        });
      }
    }
    return;
  }

  if (hasId) {
    sendError(req.id, -32601, `Method not found: ${method}`);
  }
}

// ---------- stdin 프레이밍 파서 (\n 구분 JSON-RPC + Content-Length 양방향 방어 파싱) ----------
let rawBuf = Buffer.alloc(0);
let stdinEnded = false;
let inFlight = 0;
let queue = Promise.resolve();

function maybeExit() {
  if (stdinEnded && inFlight === 0 && rawBuf.length === 0) {
    process.exit(0);
  }
}

function scheduleMessage(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    sendError(null, -32700, 'Parse error', e?.message);
    return;
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  for (const item of items) {
    inFlight++;
    queue = queue
      .then(() => handleRequest(item))
      .catch((e) => {
        process.stderr.write(`session-bridge error: ${e?.stack || e}\n`);
        if (item && item.id !== undefined && item.id !== null) {
          sendError(item.id, -32603, e?.message || 'Internal error');
        }
      })
      .finally(() => {
        inFlight--;
        maybeExit();
      });
  }
}

function skipLeadingNewlines(buf) {
  let i = 0;
  while (i < buf.length && (buf[i] === 10 || buf[i] === 13)) i++;
  return i > 0 ? buf.subarray(i) : buf;
}

function drainBuffer(flushFinal = false) {
  while (rawBuf.length > 0) {
    rawBuf = skipLeadingNewlines(rawBuf);
    if (rawBuf.length === 0) break;

    const headPreview = rawBuf.subarray(0, Math.min(rawBuf.length, 32)).toString('ascii');
    if (/^content-length\s*:/i.test(headPreview)) {
      let sepIdx = rawBuf.indexOf('\r\n\r\n');
      let sepLen = 4;
      if (sepIdx < 0) {
        sepIdx = rawBuf.indexOf('\n\n');
        sepLen = 2;
      }
      if (sepIdx < 0) break; // 헤더 수신 중

      const headerText = rawBuf.subarray(0, sepIdx).toString('ascii');
      const m = headerText.match(/content-length\s*:\s*(\d+)/i);
      if (!m) {
        rawBuf = rawBuf.subarray(sepIdx + sepLen);
        sendError(null, -32700, 'Parse error: missing Content-Length value');
        continue;
      }
      const len = Number(m[1]);
      if (!Number.isFinite(len) || len < 0 || len > 16 * 1024 * 1024) {
        rawBuf = rawBuf.subarray(sepIdx + sepLen);
        sendError(null, -32600, 'Invalid Content-Length');
        continue;
      }
      const bodyStart = sepIdx + sepLen;
      if (rawBuf.length < bodyStart + len) break; // 본문 수신 중

      const bodyText = rawBuf.subarray(bodyStart, bodyStart + len).toString('utf8');
      rawBuf = rawBuf.subarray(bodyStart + len);
      if (bodyText.trim()) scheduleMessage(bodyText);
      continue;
    }

    const nlIdx = rawBuf.indexOf(10);
    if (nlIdx < 0) {
      if (flushFinal) {
        const tail = rawBuf.toString('utf8').trim();
        rawBuf = Buffer.alloc(0);
        if (tail) scheduleMessage(tail);
      }
      break;
    }

    const line = rawBuf.subarray(0, nlIdx).toString('utf8').trim();
    rawBuf = rawBuf.subarray(nlIdx + 1);
    if (line) scheduleMessage(line);
  }
}

process.stdin.on('data', (chunk) => {
  const bufChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
  rawBuf = rawBuf.length ? Buffer.concat([rawBuf, bufChunk]) : bufChunk;
  drainBuffer(false);
});

process.stdin.on('end', () => {
  stdinEnded = true;
  drainBuffer(true);
  maybeExit();
});

process.stdin.on('error', (e) => {
  process.stderr.write(`session-bridge stdin error: ${e?.message || e}\n`);
});
