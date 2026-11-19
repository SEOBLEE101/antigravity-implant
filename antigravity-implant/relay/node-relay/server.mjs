// 제로 의존성 Node 18+ 세션 메쉬 중계 서버.
// 직접 실행: MESH_SECRET=... [HOST=127.0.0.1] [PORT=8787] [RELAY_DATA_DIR=...] node server.mjs
import http from 'node:http';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BODY_BYTES = 16 * 1024;
const HARD_DRAIN_BYTES = 2 * 1024 * 1024;
const MAX_QUEUE_PER_MACHINE = 200;
const MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PRESENCE_TTL_MS = 10 * 60 * 1000;
const MAX_SKEW_MS = 300 * 1000;
const MACHINE_ID_RE = /^[a-zA-Z0-9._-]{2,48}$/;
const HEX64_RE = /^[0-9a-f]{64}$/i;

function atomicWrite(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (e) {
      if (i >= 5 || !/EPERM|EACCES|EBUSY/.test(String(e.code))) {
        try { rmSync(tmp, { force: true }); } catch {}
        throw e;
      }
      const until = Date.now() + 30 * (i + 1);
      while (Date.now() < until) { /* 잠시 대기 */ }
    }
  }
}

function parseTimestampMs(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return NaN;
  const s = raw.trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n < 1e12 ? n * 1000 : n;
  }
  return Date.parse(s);
}

function verifyRequestAuth(headers, method, pathname, bodyText, secret, nowMs = Date.now()) {
  const ts = String(headers['x-mesh-timestamp'] || '');
  const machineId = String(headers['x-mesh-machine'] || '');
  const sigHex = String(headers['x-mesh-signature'] || '').trim();
  if (!ts || !machineId || !sigHex) return { ok: false, error: 'missing_auth_headers' };
  if (!MACHINE_ID_RE.test(machineId)) return { ok: false, error: 'invalid_machine' };
  const tsMs = parseTimestampMs(ts);
  if (!Number.isFinite(tsMs) || Math.abs(nowMs - tsMs) > MAX_SKEW_MS) {
    return { ok: false, error: 'timestamp_out_of_range' };
  }
  if (!HEX64_RE.test(sigHex)) return { ok: false, error: 'invalid_signature' };

  const canonical = `${method.toUpperCase()}\n${pathname}\n${ts}\n${machineId}\n${bodyText}`;
  const expectedHex = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(sigHex.toLowerCase(), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: 'unauthorized' };
  }
  return { ok: true, machineId };
}

function readBodyLimited(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        if (total > HARD_DRAIN_BYTES) req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolveBody({
        tooLarge,
        text: tooLarge ? '' : Buffer.concat(chunks).toString('utf8'),
      });
    });
    req.on('error', (err) => rejectBody(err));
  });
}

function sendJson(res, status, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function pruneQueue(list, nowMs) {
  if (!Array.isArray(list)) return [];
  return list.filter((item) => item && typeof item.expiresAt === 'number' && item.expiresAt > nowMs);
}

function prunePresence(map, nowMs) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const [k, v] of Object.entries(map)) {
    if (v && typeof v.expiresAt === 'number' && v.expiresAt > nowMs) {
      out[k] = v;
    }
  }
  return out;
}

export function createRelayServer({ secret, host = '127.0.0.1', port = 8787, dataDir = '' } = {}) {
  if (!secret || typeof secret !== 'string') {
    throw new Error('MESH_SECRET (secret) is required to start relay server');
  }

  let queues = {};
  let presence = {};
  const stateFile = dataDir ? join(dataDir, 'relay-state.json') : '';

  if (stateFile) {
    mkdirSync(dataDir, { recursive: true });
    if (existsSync(stateFile)) {
      try {
        const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          if (parsed.queues && typeof parsed.queues === 'object') queues = parsed.queues;
          if (parsed.presence && typeof parsed.presence === 'object') presence = parsed.presence;
        }
      } catch {}
    }
  }

  const persist = () => {
    if (!stateFile) return;
    atomicWrite(stateFile, JSON.stringify({ queues, presence }));
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const pathname = url.pathname;
      const method = (req.method || 'GET').toUpperCase();

      if (method === 'GET' && pathname === '/v1/health') {
        return sendJson(res, 200, { ok: true, v: 1, service: 'antigravity-mesh-relay' });
      }

      if (!pathname.startsWith('/v1/')) {
        return sendJson(res, 404, { error: 'not_found' });
      }

      // 인증 헤더가 아예 없으면 본문을 버퍼링하지 않고 즉시 거부한다.
      if (!req.headers['x-mesh-timestamp'] || !req.headers['x-mesh-machine'] || !req.headers['x-mesh-signature']) {
        return sendJson(res, 401, { error: 'unauthorized' });
      }

      const bodyRead = method === 'GET' || method === 'HEAD'
        ? { tooLarge: false, text: '' }
        : await readBodyLimited(req, MAX_BODY_BYTES);
      if (bodyRead.tooLarge) {
        return sendJson(res, 413, { error: 'payload_too_large' });
      }

      const nowMs = Date.now();
      const auth = verifyRequestAuth(req.headers, method, pathname, bodyRead.text, secret, nowMs);
      if (!auth.ok) {
        return sendJson(res, 401, { error: 'unauthorized' });
      }

      if (method === 'POST' && pathname === '/v1/send') {
        let body;
        try {
          body = bodyRead.text ? JSON.parse(bodyRead.text) : null;
        } catch {
          return sendJson(res, 400, { error: 'invalid_json' });
        }
        const envelope = body && typeof body === 'object' && body.envelope && typeof body.envelope === 'object'
          ? body.envelope
          : body;
        const targetMachine = envelope && typeof envelope === 'object' && envelope.to && typeof envelope.to.machineId === 'string'
          ? envelope.to.machineId
          : '';
        if (!MACHINE_ID_RE.test(targetMachine)) {
          return sendJson(res, 400, { error: 'invalid_envelope' });
        }
        const id = typeof envelope.id === 'string' && /^[\w.:-]{1,128}$/.test(envelope.id)
          ? envelope.id
          : randomUUID();

        const q = pruneQueue(queues[targetMachine], nowMs);
        if (!q.some((item) => item.id === id)) {
          q.push({
            id,
            envelope,
            receivedAt: new Date(nowMs).toISOString(),
            expiresAt: nowMs + MESSAGE_TTL_MS,
          });
        }
        while (q.length > MAX_QUEUE_PER_MACHINE) q.shift();
        queues[targetMachine] = q;
        persist();
        return sendJson(res, 200, { ok: true, id, queued: q.length });
      }

      if (method === 'GET' && pathname === '/v1/pull') {
        const reqMachine = url.searchParams.get('machine');
        if (reqMachine !== null && reqMachine !== auth.machineId) {
          return sendJson(res, 403, { error: 'forbidden' });
        }
        const machine = reqMachine || auth.machineId;
        const limitRaw = Number(url.searchParams.get('limit') || 20);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), MAX_QUEUE_PER_MACHINE) : 20;

        const prev = queues[machine] || [];
        const q = pruneQueue(prev, nowMs);
        if (q.length !== prev.length) {
          if (q.length) queues[machine] = q;
          else delete queues[machine];
          persist();
        }
        const items = q.slice(0, limit).map(({ id, envelope, receivedAt }) => ({ id, envelope, receivedAt }));
        return sendJson(res, 200, { ok: true, items });
      }

      if (method === 'POST' && pathname === '/v1/ack') {
        let body;
        try {
          body = bodyRead.text ? JSON.parse(bodyRead.text) : null;
        } catch {
          return sendJson(res, 400, { error: 'invalid_json' });
        }
        if (!body || typeof body !== 'object' || body.machineId !== auth.machineId) {
          return sendJson(res, 403, { error: 'forbidden' });
        }
        const idSet = new Set(Array.isArray(body.ids) ? body.ids.map(String) : []);
        const current = pruneQueue(queues[auth.machineId], nowMs);
        const remaining = current.filter((item) => !idSet.has(item.id));
        const removed = current.length - remaining.length;
        if (remaining.length) queues[auth.machineId] = remaining;
        else delete queues[auth.machineId];
        if (removed > 0 || current.length !== (queues[auth.machineId] || []).length) {
          persist();
        }
        return sendJson(res, 200, { ok: true, removed });
      }

      if (method === 'POST' && pathname === '/v1/presence') {
        let body;
        try {
          body = bodyRead.text ? JSON.parse(bodyRead.text) : null;
        } catch {
          return sendJson(res, 400, { error: 'invalid_json' });
        }
        if (!body || typeof body !== 'object' || body.machineId !== auth.machineId) {
          return sendJson(res, 403, { error: 'forbidden' });
        }
        presence = prunePresence(presence, nowMs);
        presence[auth.machineId] = {
          machineId: auth.machineId,
          displayName: String(body.displayName || auth.machineId).slice(0, 64),
          sessions: Array.isArray(body.sessions) ? body.sessions.slice(0, 50) : [],
          updatedAt: new Date(nowMs).toISOString(),
          expiresAt: nowMs + PRESENCE_TTL_MS,
        };
        persist();
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'GET' && pathname === '/v1/presence') {
        const beforeCount = Object.keys(presence).length;
        presence = prunePresence(presence, nowMs);
        if (Object.keys(presence).length !== beforeCount) persist();
        return sendJson(res, 200, { ok: true, machines: presence });
      }

      return sendJson(res, 404, { error: 'not_found' });
    } catch {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
    }
  });

  server.listen(port, host);
  return server;
}

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  const secret = process.env.MESH_SECRET || '';
  if (!secret) {
    process.stderr.write('오류: MESH_SECRET 환경 변수가 필요합니다.\n');
    process.exit(1);
  }
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`오류: 잘못된 PORT 값입니다: ${process.env.PORT}\n`);
    process.exit(1);
  }
  const dataDir = process.env.RELAY_DATA_DIR || '';
  const srv = createRelayServer({ secret, host, port, dataDir });
  srv.on('listening', () => {
    const addr = srv.address();
    const bound = typeof addr === 'object' && addr ? `${addr.address}:${addr.port}` : `${host}:${port}`;
    process.stdout.write(`antigravity-mesh-relay listening on http://${bound}\n`);
  });
  const shutdown = () => srv.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
