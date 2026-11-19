// 세션 메쉬 원격 수신 · 주기 동기화 데몬.
// 사용: node cli/mesh-daemon.mjs [--allow-any] [--once]
import http from 'node:http';
import { readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite, logError } from '../hooks/lib/common.mjs';
import {
  MESH_DAEMON_PID_FILE,
  loadMeshConfig,
  ensureMeshIdentity,
  verifyHttpRequest,
  listLocalSessions,
  deliverIncomingEnvelope,
  publishFolderPresence,
  pollFolderTransport,
  publishRelayPresence,
  pollRelayTransport,
  fetchHttpPeerSessions,
} from '../hooks/lib/mesh.mjs';

const MAX_BODY_BYTES = 16 * 1024;
const HARD_DRAIN_BYTES = 2 * 1024 * 1024;
const PID_HEARTBEAT_MS = 4000;
const HTTP_CACHE_REFRESH_MS = 15000;

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
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function verifyPeerHttpAuth(headers, method, pathname, bodyText, cfg) {
  const rawMachine = String(headers['x-mesh-machine'] || '').trim();
  const peerSecret = rawMachine ? cfg.transports?.http?.peers?.[rawMachine]?.secret : '';
  const candidates = [];
  if (peerSecret) candidates.push(peerSecret);
  if (cfg.secret && cfg.secret !== peerSecret) candidates.push(cfg.secret);

  for (const sec of candidates) {
    const auth = verifyHttpRequest(headers, { method, path: pathname, bodyText }, sec);
    if (auth.ok) return { ...auth, secret: sec };
  }
  return { ok: false, error: 'unauthorized' };
}

function checkRateLimit(rateMap, machineId, limitPerMin, nowMs = Date.now()) {
  const limit = Math.max(1, Number(limitPerMin) || 30);
  const cutoff = nowMs - 60000;
  const list = (rateMap.get(machineId) || []).filter((ts) => ts > cutoff);
  if (list.length >= limit) {
    rateMap.set(machineId, list);
    return false;
  }
  list.push(nowMs);
  rateMap.set(machineId, list);
  return true;
}

function writePidFile(machineId, startedAt) {
  try {
    atomicWrite(MESH_DAEMON_PID_FILE, JSON.stringify({
      pid: process.pid,
      machineId,
      startedAt,
      updatedAt: new Date().toISOString(),
    }, null, 2));
  } catch (e) {
    logError('mesh-daemon.writePidFile', e);
  }
}

function cleanupPidFile() {
  try {
    const raw = JSON.parse(readFileSync(MESH_DAEMON_PID_FILE, 'utf8'));
    if (raw && raw.pid === process.pid) unlinkSync(MESH_DAEMON_PID_FILE);
  } catch {}
}

async function runSyncCycle(cfg) {
  if (cfg.enabled === false) return;
  if (cfg.transports?.folder?.enabled && cfg.transports?.folder?.rootDir) {
    try {
      publishFolderPresence(cfg);
      pollFolderTransport(cfg);
    } catch (e) {
      logError('mesh-daemon.folder', e);
    }
  }
  if (cfg.transports?.relay?.enabled && cfg.transports?.relay?.url && cfg.transports?.relay?.secret) {
    try {
      await publishRelayPresence(cfg);
      await pollRelayTransport(cfg);
    } catch (e) {
      logError('mesh-daemon.relay', e);
    }
  }
  if (cfg.transports?.http?.enabled) {
    try {
      await fetchHttpPeerSessions(cfg);
    } catch (e) {
      logError('mesh-daemon.httpPeers', e);
    }
  }
}

export async function startMeshDaemon({ allowAny = false, once = false } = {}) {
  const cfg = ensureMeshIdentity();
  const httpCfg = cfg.transports?.http || {};
  const bindHost = httpCfg.bindHost || '127.0.0.1';
  const port = Number(httpCfg.port ?? 47821);
  const allowAll = Boolean(allowAny || httpCfg.allowAllInterfaces === true);

  if (httpCfg.enabled && (bindHost === '0.0.0.0' || bindHost === '::') && !allowAll) {
    throw new Error(`거부: bindHost "${bindHost}" 는 allowAllInterfaces: true 또는 --allow-any 없이 사용할 수 없습니다.`);
  }

  const startedAt = new Date().toISOString();
  writePidFile(cfg.machineId, startedAt);

  if (once) {
    try {
      await runSyncCycle(cfg);
    } finally {
      cleanupPidFile();
    }
    return { ok: true, once: true, machineId: cfg.machineId };
  }

  const rateMap = new Map();
  let server = null;

  if (httpCfg.enabled) {
    server = http.createServer(async (req, res) => {
      try {
        const liveCfg = loadMeshConfig({ createIfMissing: false });
        if (liveCfg.enabled === false) {
          return sendJson(res, 503, { error: 'mesh_disabled' });
        }

        const url = new URL(req.url || '/', 'http://localhost');
        const pathname = url.pathname;
        const method = (req.method || 'GET').toUpperCase();

        if (method === 'GET' && pathname === '/v1/health') {
          return sendJson(res, 200, {
            ok: true,
            v: 1,
            machineId: liveCfg.machineId,
            service: 'antigravity-mesh-peer',
          });
        }

        if (method === 'GET' && pathname === '/v1/sessions') {
          const auth = verifyPeerHttpAuth(req.headers, method, pathname, '', liveCfg);
          if (!auth.ok) return sendJson(res, 401, { error: 'unauthorized' });
          return sendJson(res, 200, {
            ok: true,
            machineId: liveCfg.machineId,
            displayName: liveCfg.displayName || liveCfg.machineId,
            sessions: listLocalSessions(),
          });
        }

        if (method === 'POST' && pathname === '/v1/deliver') {
          if (!req.headers['x-mesh-timestamp'] || !req.headers['x-mesh-machine'] || !req.headers['x-mesh-signature']) {
            return sendJson(res, 401, { error: 'unauthorized' });
          }
          const bodyRead = await readBodyLimited(req, MAX_BODY_BYTES);
          if (bodyRead.tooLarge) {
            return sendJson(res, 413, { error: 'payload_too_large' });
          }

          const auth = verifyPeerHttpAuth(req.headers, method, pathname, bodyRead.text, liveCfg);
          if (!auth.ok) return sendJson(res, 401, { error: 'unauthorized' });

          if (!checkRateLimit(rateMap, auth.machineId, liveCfg.rateLimitPerMin)) {
            return sendJson(res, 429, { error: 'rate_limit_exceeded' });
          }

          let body;
          try {
            body = bodyRead.text ? JSON.parse(bodyRead.text) : null;
          } catch {
            return sendJson(res, 400, { error: 'invalid_json' });
          }
          const envelope = body && typeof body === 'object' && body.envelope && typeof body.envelope === 'object'
            ? body.envelope
            : body;
          if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
            return sendJson(res, 400, { error: 'invalid_envelope' });
          }

          const delivered = deliverIncomingEnvelope(envelope, {
            expectedSecret: auth.secret,
            sourceTransport: 'http',
            cfg: liveCfg,
          });
          if (!delivered.ok) {
            const code = /signature|skew|secret/i.test(String(delivered.error || '')) ? 401 : 400;
            return sendJson(res, code, { ok: false, error: delivered.error || 'delivery_rejected' });
          }
          return sendJson(res, 200, delivered);
        }

        return sendJson(res, 404, { error: 'not_found' });
      } catch (e) {
        logError('mesh-daemon.http', e);
        if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
      }
    });

    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(port, bindHost, () => {
        server.removeListener('error', rejectListen);
        const addr = server.address();
        const bound = typeof addr === 'object' && addr ? `${addr.address}:${addr.port}` : `${bindHost}:${port}`;
        process.stdout.write(`mesh-daemon listening on http://${bound} (machine: ${cfg.machineId})\n`);
        resolveListen();
      });
    });
  } else {
    process.stdout.write(`mesh-daemon started without HTTP listener (machine: ${cfg.machineId})\n`);
  }

  const timers = [];
  timers.push(setInterval(() => {
    const liveCfg = loadMeshConfig({ createIfMissing: false });
    writePidFile(liveCfg.machineId, startedAt);
  }, PID_HEARTBEAT_MS));

  let folderBusy = false;
  const folderMs = Math.max(1000, Number(cfg.transports?.folder?.pollIntervalMs) || 5000);
  timers.push(setInterval(() => {
    if (folderBusy) return;
    const liveCfg = loadMeshConfig({ createIfMissing: false });
    if (liveCfg.enabled === false || !liveCfg.transports?.folder?.enabled || !liveCfg.transports?.folder?.rootDir) return;
    folderBusy = true;
    try {
      publishFolderPresence(liveCfg);
      pollFolderTransport(liveCfg);
    } catch (e) {
      logError('mesh-daemon.folderLoop', e);
    } finally {
      folderBusy = false;
    }
  }, folderMs));

  let relayBusy = false;
  const relayMs = Math.max(1000, Number(cfg.transports?.relay?.pollIntervalMs) || 3000);
  timers.push(setInterval(async () => {
    if (relayBusy) return;
    const liveCfg = loadMeshConfig({ createIfMissing: false });
    if (liveCfg.enabled === false || !liveCfg.transports?.relay?.enabled || !liveCfg.transports?.relay?.url || !liveCfg.transports?.relay?.secret) return;
    relayBusy = true;
    try {
      await publishRelayPresence(liveCfg);
      await pollRelayTransport(liveCfg);
    } catch (e) {
      logError('mesh-daemon.relayLoop', e);
    } finally {
      relayBusy = false;
    }
  }, relayMs));

  let httpCacheBusy = false;
  timers.push(setInterval(async () => {
    if (httpCacheBusy) return;
    const liveCfg = loadMeshConfig({ createIfMissing: false });
    if (liveCfg.enabled === false || !liveCfg.transports?.http?.enabled) return;
    httpCacheBusy = true;
    try {
      await fetchHttpPeerSessions(liveCfg);
    } catch (e) {
      logError('mesh-daemon.httpCacheLoop', e);
    } finally {
      httpCacheBusy = false;
    }
  }, HTTP_CACHE_REFRESH_MS));

  // 시작 직후 비동기로 초기 동기화 1회 수행
  setImmediate(() => {
    runSyncCycle(loadMeshConfig({ createIfMissing: false })).catch((e) => logError('mesh-daemon.initialSync', e));
  });

  const stop = () => {
    for (const t of timers) clearInterval(t);
    cleanupPidFile();
    if (server) {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    } else {
      process.exit(0);
    }
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return { ok: true, server, stop };
}

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const allowAny = args.includes('--allow-any');
  const once = args.includes('--once');
  startMeshDaemon({ allowAny, once }).catch((err) => {
    process.stderr.write(`오류: ${err && err.message ? err.message : String(err)}\n`);
    cleanupPidFile();
    process.exit(1);
  });
}
