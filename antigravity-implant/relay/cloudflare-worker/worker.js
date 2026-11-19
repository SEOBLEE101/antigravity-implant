// Cloudflare Worker + Durable Object (무료 플랜 SQLite DO 호환) 세션 메쉬 중계 서버.
// Node Relay (relay/node-relay/server.mjs)와 동일한 /v1/* API 및 HMAC-SHA256 규격을 구현합니다.

const MAX_BODY_BYTES = 16 * 1024;
const MAX_QUEUE_PER_MACHINE = 200;
const MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PRESENCE_TTL_MS = 10 * 60 * 1000;
const MAX_SKEW_MS = 300 * 1000;
const MACHINE_ID_RE = /^[a-zA-Z0-9._-]{2,48}$/;
const HEX64_RE = /^[0-9a-f]{64}$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
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

function hexToBytes(hex) {
  if (!HEX64_RE.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function verifyRequestAuth(headers, method, pathname, bodyText, secret, nowMs = Date.now()) {
  const ts = String(headers.get('x-mesh-timestamp') || '');
  const machineId = String(headers.get('x-mesh-machine') || '');
  const sigHex = String(headers.get('x-mesh-signature') || '').trim();
  if (!ts || !machineId || !sigHex) return { ok: false, error: 'missing_auth_headers' };
  if (!MACHINE_ID_RE.test(machineId)) return { ok: false, error: 'invalid_machine' };
  const tsMs = parseTimestampMs(ts);
  if (!Number.isFinite(tsMs) || Math.abs(nowMs - tsMs) > MAX_SKEW_MS) {
    return { ok: false, error: 'timestamp_out_of_range' };
  }
  const sigBytes = hexToBytes(sigHex);
  if (!sigBytes) return { ok: false, error: 'invalid_signature' };

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const canonical = `${method.toUpperCase()}\n${pathname}\n${ts}\n${machineId}\n${bodyText}`;
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(canonical));
  if (!valid) return { ok: false, error: 'unauthorized' };
  return { ok: true, machineId };
}

async function readBodyLimited(request, maxBytes = MAX_BODY_BYTES) {
  const cl = Number(request.headers.get('content-length'));
  if (Number.isFinite(cl) && cl > maxBytes) {
    return { tooLarge: true, text: '' };
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) {
    return { tooLarge: true, text: '' };
  }
  return { tooLarge: false, text: decoder.decode(buf) };
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

export class MeshHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env || {};
    this._mutex = Promise.resolve();
  }

  _withLock(fn) {
    const next = this._mutex.then(fn, fn);
    this._mutex = next.catch(() => {});
    return next;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = (request.method || 'GET').toUpperCase();

    if (method === 'GET' && pathname === '/v1/health') {
      return jsonResponse(200, { ok: true, v: 1, service: 'antigravity-mesh-relay' });
    }

    if (!pathname.startsWith('/v1/')) {
      return jsonResponse(404, { error: 'not_found' });
    }

    const secret = this.env && typeof this.env.MESH_SECRET === 'string' ? this.env.MESH_SECRET : '';
    if (!secret) {
      return jsonResponse(500, { error: 'relay_not_configured' });
    }

    if (!request.headers.get('x-mesh-timestamp') || !request.headers.get('x-mesh-machine') || !request.headers.get('x-mesh-signature')) {
      return jsonResponse(401, { error: 'unauthorized' });
    }

    const bodyRead = method === 'GET' || method === 'HEAD'
      ? { tooLarge: false, text: '' }
      : await readBodyLimited(request, MAX_BODY_BYTES);
    if (bodyRead.tooLarge) {
      return jsonResponse(413, { error: 'payload_too_large' });
    }

    const nowMs = Date.now();
    const auth = await verifyRequestAuth(request.headers, method, pathname, bodyRead.text, secret, nowMs);
    if (!auth.ok) {
      return jsonResponse(401, { error: 'unauthorized' });
    }

    if (method === 'POST' && pathname === '/v1/send') {
      let body;
      try {
        body = bodyRead.text ? JSON.parse(bodyRead.text) : null;
      } catch {
        return jsonResponse(400, { error: 'invalid_json' });
      }
      const envelope = body && typeof body === 'object' && body.envelope && typeof body.envelope === 'object'
        ? body.envelope
        : body;
      const targetMachine = envelope && typeof envelope === 'object' && envelope.to && typeof envelope.to.machineId === 'string'
        ? envelope.to.machineId
        : '';
      if (!MACHINE_ID_RE.test(targetMachine)) {
        return jsonResponse(400, { error: 'invalid_envelope' });
      }
      const id = typeof envelope.id === 'string' && /^[\w.:-]{1,128}$/.test(envelope.id)
        ? envelope.id
        : crypto.randomUUID();

      return this._withLock(async () => {
        const key = `q:${targetMachine}`;
        const q = pruneQueue(await this.ctx.storage.get(key), nowMs);
        if (!q.some((item) => item.id === id)) {
          q.push({
            id,
            envelope,
            receivedAt: new Date(nowMs).toISOString(),
            expiresAt: nowMs + MESSAGE_TTL_MS,
          });
        }
        while (q.length > MAX_QUEUE_PER_MACHINE) q.shift();
        await this.ctx.storage.put(key, q);
        return jsonResponse(200, { ok: true, id, queued: q.length });
      });
    }

    if (method === 'GET' && pathname === '/v1/pull') {
      const reqMachine = url.searchParams.get('machine');
      if (reqMachine !== null && reqMachine !== auth.machineId) {
        return jsonResponse(403, { error: 'forbidden' });
      }
      const machine = reqMachine || auth.machineId;
      const limitRaw = Number(url.searchParams.get('limit') || 20);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), MAX_QUEUE_PER_MACHINE) : 20;

      return this._withLock(async () => {
        const key = `q:${machine}`;
        const prev = (await this.ctx.storage.get(key)) || [];
        const q = pruneQueue(prev, nowMs);
        if (q.length !== prev.length) {
          await this.ctx.storage.put(key, q);
        }
        const items = q.slice(0, limit).map(({ id, envelope, receivedAt }) => ({ id, envelope, receivedAt }));
        return jsonResponse(200, { ok: true, items });
      });
    }

    if (method === 'POST' && pathname === '/v1/ack') {
      let body;
      try {
        body = bodyRead.text ? JSON.parse(bodyRead.text) : null;
      } catch {
        return jsonResponse(400, { error: 'invalid_json' });
      }
      if (!body || typeof body !== 'object' || body.machineId !== auth.machineId) {
        return jsonResponse(403, { error: 'forbidden' });
      }
      const idSet = new Set(Array.isArray(body.ids) ? body.ids.map(String) : []);
      return this._withLock(async () => {
        const key = `q:${auth.machineId}`;
        const current = pruneQueue(await this.ctx.storage.get(key), nowMs);
        const remaining = current.filter((item) => !idSet.has(item.id));
        const removed = current.length - remaining.length;
        await this.ctx.storage.put(key, remaining);
        return jsonResponse(200, { ok: true, removed });
      });
    }

    if (method === 'POST' && pathname === '/v1/presence') {
      let body;
      try {
        body = bodyRead.text ? JSON.parse(bodyRead.text) : null;
      } catch {
        return jsonResponse(400, { error: 'invalid_json' });
      }
      if (!body || typeof body !== 'object' || body.machineId !== auth.machineId) {
        return jsonResponse(403, { error: 'forbidden' });
      }
      return this._withLock(async () => {
        const map = prunePresence(await this.ctx.storage.get('presence'), nowMs);
        map[auth.machineId] = {
          machineId: auth.machineId,
          displayName: String(body.displayName || auth.machineId).slice(0, 64),
          sessions: Array.isArray(body.sessions) ? body.sessions.slice(0, 50) : [],
          updatedAt: new Date(nowMs).toISOString(),
          expiresAt: nowMs + PRESENCE_TTL_MS,
        };
        await this.ctx.storage.put('presence', map);
        return jsonResponse(200, { ok: true });
      });
    }

    if (method === 'GET' && pathname === '/v1/presence') {
      return this._withLock(async () => {
        const raw = (await this.ctx.storage.get('presence')) || {};
        const map = prunePresence(raw, nowMs);
        if (Object.keys(map).length !== Object.keys(raw).length) {
          await this.ctx.storage.put('presence', map);
        }
        return jsonResponse(200, { ok: true, machines: map });
      });
    }

    return jsonResponse(404, { error: 'not_found' });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/v1/health') {
      return jsonResponse(200, { ok: true, v: 1, service: 'antigravity-mesh-relay' });
    }
    const id = env.MESH_HUB.idFromName('global');
    const stub = env.MESH_HUB.get(id);
    return stub.fetch(request);
  },
};
