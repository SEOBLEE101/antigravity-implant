// 세션 메쉬 CLI (초기 설정 · 페어링 · 상태 · 세션 목록 · 전송 · 수신함 · 동기화 · 데몬).
// 사용: node cli/mesh.mjs <subcommand> [options]
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  MACHINE_ID_RE,
  ensureMeshIdentity,
  loadMeshConfig,
  saveMeshConfig,
  redactMeshConfig,
  exportPairingToken,
  importPairingToken,
  getMeshStatus,
  listAllSessions,
  sendMessage,
  readHistory,
  syncAllTransports,
} from '../hooks/lib/mesh.mjs';
import { startMeshDaemon } from './mesh-daemon.mjs';

const BOOL_FLAGS = new Set(['tailscale', 'json', 'no-wake', 'allow-any', 'once', 'all', 'help']);
const VALUE_FLAGS = new Set(['name', 'folder', 'relay', 'relay-secret', 'port', 'secret', 'transport', 'machine', 'to', 'from', 'subject', 'body', 'limit']);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq >= 0) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (BOOL_FLAGS.has(key)) {
      flags[key] = true;
    } else if (VALUE_FLAGS.has(key)) {
      if (next === undefined) throw new Error(`--${key} 옵션의 값이 필요합니다.`);
      flags[key] = next;
      i++;
    } else if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags };
}

function outJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function outText(line) {
  process.stdout.write(line + '\n');
}

function detectTailscaleIpv4() {
  try {
    const raw = execFileSync('tailscale', ['ip', '-4'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const ip = lines.find((l) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(l));
    return ip || null;
  } catch {
    return null;
  }
}

function formatTs(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('ko-KR', { hour12: false });
}

function printUsage() {
  outText([
    '사용법: node cli/mesh.mjs <명령> [옵션]',
    '  init [--name <id>] [--tailscale] [--folder <dir>] [--relay <url>] [--relay-secret <sec>] [--port <n>] [--secret <sec>] [--json]',
    '  pair-export [--transport http|folder|relay] [--json]',
    '  pair-import <agymesh1:...> [--json]',
    '  status [--json]',
    '  sessions [--machine <id>] [--json]',
    '  send --to <machine>/<convId> [--from <convId>] [--subject <s>] --body <b> [--no-wake] [--transport auto|local|http|relay|folder] [--json]',
    '  inbox [--limit N] [--all] [--json]',
    '  sync [--json]',
    '  daemon [--allow-any] [--once]',
  ].join('\n'));
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  const jsonOut = Boolean(flags.json);

  if (!cmd || flags.help) {
    printUsage();
    process.exit(cmd ? 0 : 1);
  }

  if (cmd === 'init') {
    const cur = ensureMeshIdentity();
    const patch = { transports: {} };
    const notes = [];

    if (typeof flags.name === 'string') {
      if (!MACHINE_ID_RE.test(flags.name.trim())) {
        throw new Error(`잘못된 머신 ID입니다(${MACHINE_ID_RE}): ${flags.name}`);
      }
      patch.machineId = flags.name.trim();
      patch.displayName = flags.name.trim();
    }
    if (typeof flags.secret === 'string' && flags.secret.trim()) {
      patch.secret = flags.secret.trim();
    }

    const effectivePort = flags.port !== undefined ? Number(flags.port) : (cur.transports?.http?.port || 47821);
    if (flags.port !== undefined) {
      patch.transports.http = { ...(patch.transports.http || {}), enabled: true, port: effectivePort };
    }

    if (flags.tailscale) {
      const tsIp = detectTailscaleIpv4();
      if (tsIp) {
        patch.transports.http = {
          ...(patch.transports.http || {}),
          enabled: true,
          bindHost: tsIp,
          port: effectivePort,
          advertiseUrl: `http://${tsIp}:${effectivePort}`,
        };
        notes.push(`Tailscale IPv4 감지됨: ${tsIp}`);
      } else {
        patch.transports.http = {
          ...(patch.transports.http || {}),
          bindHost: '127.0.0.1',
        };
        notes.push('Tailscale 미설치 또는 미로그인 상태라 127.0.0.1(루프백)을 유지합니다.');
      }
    }

    if (typeof flags.folder === 'string' && flags.folder.trim()) {
      patch.transports.folder = { enabled: true, rootDir: resolve(flags.folder.trim()) };
    }

    if (typeof flags.relay === 'string' || typeof flags['relay-secret'] === 'string') {
      patch.transports.relay = { enabled: true };
      if (typeof flags.relay === 'string') patch.transports.relay.url = flags.relay.trim();
      if (typeof flags['relay-secret'] === 'string') patch.transports.relay.secret = flags['relay-secret'].trim();
    }

    if (!Object.keys(patch.transports).length) delete patch.transports;
    const saved = saveMeshConfig(patch);
    const redacted = redactMeshConfig(saved);

    if (jsonOut) {
      outJson({ ok: true, notes, config: redacted });
    } else {
      outText(`세션 메쉬 초기화 완료 (머신: ${redacted.machineId})`);
      for (const n of notes) outText(`  안내: ${n}`);
      outText(`  HTTP: ${redacted.transports.http.enabled ? `켜짐 (${redacted.transports.http.bindHost}:${redacted.transports.http.port})` : '꺼짐'}`);
      outText(`  공유 폴더: ${redacted.transports.folder.enabled ? redacted.transports.folder.rootDir : '꺼짐'}`);
      outText(`  중계: ${redacted.transports.relay.enabled ? redacted.transports.relay.url : '꺼짐'}`);
    }
    return;
  }

  if (cmd === 'pair-export') {
    const transport = typeof flags.transport === 'string' ? flags.transport : 'http';
    const token = exportPairingToken({ transport });
    if (jsonOut) outJson({ ok: true, transport, token });
    else outText(token);
    return;
  }

  if (cmd === 'pair-import') {
    const token = positional[1];
    if (!token) throw new Error('가져올 페어링 토큰(agymesh1:...)을 입력하세요.');
    const res = importPairingToken(token);
    if (jsonOut) outJson(res);
    else outText(`페어링 가져오기 완료: 통로=${res.transport}${res.machineId ? `, 머신=${res.machineId}` : ''}`);
    return;
  }

  if (cmd === 'status') {
    const st = getMeshStatus();
    if (jsonOut) {
      outJson(st);
    } else {
      const tr = st.config?.transports || {};
      const peerCount = Object.keys(tr.http?.peers || {}).length;
      outText(`머신 ID: ${st.machineId} (${st.displayName || st.machineId})`);
      outText(`상태: ${st.enabled ? '활성' : '비활성'} | 데몬: ${st.daemonAlive ? '실행 중' : '정지'} | 대기 수신함: ${st.pendingInboxCount} | 깨우기 큐: ${st.pendingWakeCount}`);
      outText(`통로: 로컬=${tr.local?.enabled !== false ? '켜짐' : '꺼짐'}, HTTP=${tr.http?.enabled ? `${tr.http.bindHost}:${tr.http.port} (피어 ${peerCount})` : '꺼짐'}, 공유폴더=${tr.folder?.enabled ? tr.folder.rootDir : '꺼짐'}, 중계=${tr.relay?.enabled ? tr.relay.url : '꺼짐'}`);
    }
    return;
  }

  if (cmd === 'sessions') {
    const machine = typeof flags.machine === 'string' ? flags.machine : undefined;
    const sessions = listAllSessions({ machine });
    if (jsonOut) {
      outJson({ ok: true, count: sessions.length, sessions });
    } else if (!sessions.length) {
      outText('발견된 세션이 없습니다.');
    } else {
      for (const s of sessions) {
        const stateTag = s.state?.turnOpen ? '작업중' : '대기';
        outText(`${s.machineId}/${s.id}  [${s.local ? '로컬' : s.transport}]  (${stateTag})  ${s.title || ''}`);
      }
    }
    return;
  }

  if (cmd === 'send') {
    const toRaw = typeof flags.to === 'string' ? flags.to.trim() : '';
    const body = typeof flags.body === 'string' ? flags.body : '';
    if (!toRaw || !body) {
      throw new Error('send 에는 --to <machine>/<convId> 와 --body <내용> 이 필요합니다.');
    }
    const slash = toRaw.indexOf('/');
    const toMachine = slash >= 0 ? toRaw.slice(0, slash) : toRaw;
    const toConversationId = slash >= 0 ? (toRaw.slice(slash + 1) || 'latest') : 'latest';
    const res = await sendMessage({
      fromConversationId: typeof flags.from === 'string' ? flags.from : '',
      toMachine,
      toConversationId,
      subject: typeof flags.subject === 'string' ? flags.subject : '',
      body,
      wake: !flags['no-wake'],
      transport: typeof flags.transport === 'string' ? flags.transport : 'auto',
    });
    if (jsonOut) outJson(res);
    else if (res.ok) outText(`전송 완료 (${res.transport}): id=${res.id}, 대상=${toMachine}/${res.deliveredTo || toConversationId}`);
    else outText(`전송 실패: ${res.error || '알 수 없는 오류'}`);
    if (!res.ok) process.exitCode = 1;
    return;
  }

  if (cmd === 'inbox') {
    const limit = flags.limit !== undefined ? Math.max(1, Number(flags.limit) || 20) : 20;
    const direction = flags.all ? undefined : 'in';
    const items = readHistory({ direction, limit });
    if (jsonOut) {
      outJson({ ok: true, count: items.length, items });
    } else if (!items.length) {
      outText('수신 이력이 없습니다.');
    } else {
      for (const it of items) {
        const dir = it.direction === 'out' ? 'OUT' : 'IN';
        outText(`[${dir}] ${formatTs(it.ts)} ${it.from?.machineId || '?'}/${it.from?.conversationId || '?'} -> ${it.to?.machineId || '?'}/${it.to?.conversationId || '?'} (${it.transport || '-'}) ${it.subject ? `[${it.subject}] ` : ''}${String(it.body || '').replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
    return;
  }

  if (cmd === 'sync') {
    const res = await syncAllTransports();
    if (jsonOut) outJson(res);
    else outText(`동기화 완료: 세션 ${Array.isArray(res.sessions) ? res.sessions.length : 0}개`);
    return;
  }

  if (cmd === 'daemon') {
    await startMeshDaemon({
      allowAny: Boolean(flags['allow-any']),
      once: Boolean(flags.once),
    });
    return;
  }

  throw new Error(`알 수 없는 명령입니다: ${cmd}`);
}

main().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  if (process.argv.includes('--json')) outJson({ ok: false, error: msg });
  else process.stderr.write(`오류: ${msg}\n`);
  process.exit(1);
});
