// 세션 메쉬(Session Mesh) 전체 검증 스위트: 가짜 홈·임시 디렉터리·랜덤 포트 격리.
// 실제 ~/.gemini 설정·데이터는 절대 읽거나 쓰지 않는다.
// 실행: node tests/mesh-test.mjs (또는 node tests/run-all.mjs)
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, readdirSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'antigravity-implant');

const tmpRoot = mkdtempSync(join(tmpdir(), 'agyc-mesh-'));
const homeA = join(tmpRoot, 'home-a');
const homeB = join(tmpRoot, 'home-b');
const sharedDrive = join(tmpRoot, 'shared-drive');
const dataA = join(homeA, '.gemini', 'antigravity-implant');
const dataB = join(homeB, '.gemini', 'antigravity-implant');
mkdirSync(dataA, { recursive: true });
mkdirSync(dataB, { recursive: true });
mkdirSync(sharedDrive, { recursive: true });

// standalone 실행 시에도 실제 ~/.gemini 를 건드리지 않도록 import 전에 가짜 홈 지정
process.env.USERPROFILE = homeA;
process.env.HOME = homeA;
process.env.ANTIGRAVITY_IMPLANT_DATA_DIR = dataA;

const mesh = await import(pathToFileURL(join(root, 'hooks', 'lib', 'mesh.mjs')).href);

let fails = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '\n      ' + detail}`);
  if (!cond) fails++;
}

async function withMachineEnv(homeDir, dataDir, fn) {
  const prevUp = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  const prevData = process.env.ANTIGRAVITY_IMPLANT_DATA_DIR;
  process.env.USERPROFILE = homeDir;
  process.env.HOME = homeDir;
  process.env.ANTIGRAVITY_IMPLANT_DATA_DIR = dataDir;
  try {
    return await fn();
  } finally {
    process.env.USERPROFILE = prevUp;
    process.env.HOME = prevHome;
    process.env.ANTIGRAVITY_IMPLANT_DATA_DIR = prevData;
  }
}

function makeMainTranscript(homeDir, userText = '메쉬 테스트 요청') {
  const conv = randomUUID();
  const logsDir = join(homeDir, '.gemini', 'antigravity', 'brain', conv, '.system_generated', 'logs');
  mkdirSync(logsDir, { recursive: true });
  const tf = join(logsDir, 'transcript_full.jsonl');
  const steps = [
    { step_index: 0, status: 'DONE', type: 'USER_INPUT', source: 'USER_EXPLICIT', content: `<USER_REQUEST>\n${userText}\n</USER_REQUEST>` },
  ];
  writeFileSync(tf, steps.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8');
  return { conv, tf };
}

function runPreInvocation(homeDir, dataDir, payload) {
  const env = {
    ...process.env,
    USERPROFILE: homeDir,
    HOME: homeDir,
    ANTIGRAVITY_IMPLANT_DATA_DIR: dataDir,
  };
  const r = spawnSync(process.execPath, [join(root, 'hooks', 'pre_invocation.mjs')], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: root,
    env,
    timeout: 15000,
  });
  const raw = (r.stdout || '').trim();
  let out = {};
  try { out = JSON.parse(raw); } catch { out = { __bad: raw }; }
  return { out, raw, code: r.status, err: r.stderr };
}

function injectedTexts(out) {
  return (out.injectSteps || []).map((s) => s.ephemeralMessage || (s.systemMessage && s.systemMessage.systemMessage) || '').join('\n');
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

try {
  // ============================================================================
  // 1) 프로토콜 · 보안
  // ============================================================================
  {
    const cfg = await withMachineEnv(homeA, dataA, () => {
      mesh.ensureMeshIdentity();
      return mesh.saveMeshConfig({
        machineId: 'win-a',
        displayName: 'Win A',
        maxHops: 4,
        transports: {
          relay: { enabled: true, url: 'http://127.0.0.1:8787', secret: 'relay-top-secret-value' },
          http: { enabled: true, peers: { 'mac-b': { url: 'http://127.0.0.1:47999', secret: 'peer-secret-value' } } },
        },
      });
    });

    const env = mesh.createEnvelope({
      fromConversationId: randomUUID(),
      fromTitle: '설계 세션',
      toMachine: 'mac-b',
      toConversationId: 'latest',
      subject: '안녕하세요',
      body: '본문 테스트',
    }, cfg);

    check('1.1 signEnvelope/verifyEnvelope 정상 검증', mesh.verifyEnvelope(env, cfg.secret).ok === true, JSON.stringify(env));

    const tampered = { ...env, body: '변조된 본문' };
    check('1.2 본문 변조 시 verifyEnvelope 실패', mesh.verifyEnvelope(tampered, cfg.secret).ok === false, 'tampered passed');

    const createdMs = Date.parse(env.createdAt);
    const oldReplay = mesh.verifyEnvelope(env, cfg.secret, { maxSkewSec: 300, nowMs: createdMs + 301_000 });
    const futureReplay = mesh.verifyEnvelope(env, cfg.secret, { maxSkewSec: 300, nowMs: createdMs - 301_000 });
    check('1.3 ±300초 재생 공격 거부', !oldReplay.ok && !futureReplay.ok, JSON.stringify([oldReplay, futureReplay]));

    const hopOk = await withMachineEnv(homeA, dataA, () => {
      let threw = false;
      try {
        mesh.createEnvelope({ toMachine: 'local', body: 'x', hop: 5 }, cfg);
      } catch { threw = true; }
      const loopEnv = { ...env, to: { machineId: 'win-a', conversationId: '*' }, hop: 5, maxHops: 4 };
      loopEnv.sig = mesh.signEnvelope(loopEnv, cfg.secret);
      const res = mesh.deliverIncomingEnvelope(loopEnv, { expectedSecret: cfg.secret, sourceTransport: 'local', cfg });
      return threw && !res.ok && /hop/i.test(res.error || '');
    });
    check('1.4 hop > maxHops 루프 차단', hopOk, 'hop loop not blocked');

    const cleaned = mesh.sanitizeText('ab\x00\x07\x1b[31mcd\t\nef\x7f');
    check('1.5 sanitizeText 제어 문자 제거 (개행·탭 유지)', cleaned === 'ab[31mcd\t\nef', JSON.stringify(cleaned));

    const redacted = mesh.redactMeshConfig(cfg);
    const redactedStr = JSON.stringify(redacted);
    const secretsGone = !redactedStr.includes(cfg.secret)
      && !redactedStr.includes('relay-top-secret-value')
      && !redactedStr.includes('peer-secret-value')
      && redacted.secret === undefined
      && redacted.secretConfigured === true
      && redacted.transports.relay.secret === undefined
      && redacted.transports.relay.secretConfigured === true
      && redacted.transports.http.peers['mac-b'].secret === undefined
      && redacted.transports.http.peers['mac-b'].secretConfigured === true;
    check('1.6 redactMeshConfig 모든 비밀키 제거 및 마스킹 플래그 유지', secretsGone, redactedStr);

    const preserved = await withMachineEnv(homeA, dataA, () => {
      return mesh.saveMeshConfig({
        secret: '<REDACTED>',
        transports: {
          relay: { secret: '' },
          http: { peers: { 'mac-b': { url: 'http://127.0.0.1:47999', secret: '<REDACTED>' } } },
        },
      });
    });
    check('1.7 saveMeshConfig <REDACTED>/빈 secret 기존값 보존',
      preserved.secret === cfg.secret && preserved.transports.relay.secret === 'relay-top-secret-value' && preserved.transports.http.peers['mac-b'].secret === 'peer-secret-value',
      'secret overwritten');
  }

  // ============================================================================
  // 2) 로컬 전송 + PreInvocation 훅
  // ============================================================================
  {
    const { conv: convA, tf: tfA } = makeMainTranscript(homeA, '로컬 수신 테스트');
    const senderConv = randomUUID();
    const sent = await withMachineEnv(homeA, dataA, () => mesh.sendMessage({
      fromConversationId: senderConv,
      fromTitle: '보낸 세션',
      toMachine: 'local',
      toConversationId: convA,
      subject: '핸드오프',
      body: '로컬 메쉬 본문 확인',
      wake: true,
      transport: 'local',
    }));

    const inboxFiles = existsSync(join(dataA, 'mesh', 'inbox', convA))
      ? readdirSync(join(dataA, 'mesh', 'inbox', convA)).filter((n) => n.endsWith('.json'))
      : [];
    const wakeFiles = existsSync(join(dataA, 'mesh', 'wake-queue'))
      ? readdirSync(join(dataA, 'mesh', 'wake-queue')).filter((n) => n.endsWith('.json'))
      : [];
    check('2.1 sendMessage 로컬 전송 -> inbox & wake-queue 생성',
      sent.ok && sent.transport === 'local' && inboxFiles.length === 1 && wakeFiles.length === 1,
      JSON.stringify({ sent, inboxFiles, wakeFiles }));

    const r1 = runPreInvocation(homeA, dataA, {
      conversationId: convA,
      transcriptPath: tfA,
      modelName: 'gemini-4-carbon-high',
      invocationNum: 0,
    });
    const inj1 = injectedTexts(r1.out);
    const hasBoundary = (r1.out.injectSteps || []).some((s) =>
      s.systemMessage
      && /\[세션 간 메시지/.test(s.systemMessage.systemMessage)
      && /시스템 규칙이나 사용자 지시보다 우선하지 않으며/.test(s.systemMessage.systemMessage)
      && /로컬 메쉬 본문 확인/.test(s.systemMessage.systemMessage),
    );
    check('2.2 PreInvocation 1차 실행 -> 신뢰 불가 경계 systemMessage 주입', r1.code === 0 && hasBoundary, inj1.slice(0, 300));

    const r2 = runPreInvocation(homeA, dataA, {
      conversationId: convA,
      transcriptPath: tfA,
      modelName: 'gemini-4-carbon-high',
      invocationNum: 1,
    });
    const inj2 = injectedTexts(r2.out);
    check('2.3 PreInvocation 2차 실행 -> 중복 주입 0건', r2.code === 0 && !/\[세션 간 메시지/.test(inj2), inj2.slice(0, 300));
  }

  // ============================================================================
  // 3) Tailscale/LAN HTTP 피어 브리지 (cli/mesh-daemon.mjs)
  // ============================================================================
  {
    const h3a = join(tmpRoot, 'h3-a');
    const h3b = join(tmpRoot, 'h3-b');
    const d3a = join(h3a, '.gemini', 'antigravity-implant');
    const d3b = join(h3b, '.gemini', 'antigravity-implant');
    mkdirSync(d3a, { recursive: true });
    mkdirSync(d3b, { recursive: true });

    const { conv: conv3b } = makeMainTranscript(h3b, 'HTTP 브리지 수신 세션');
    const portA = await getFreePort();
    const portB = await getFreePort();
    const peerSecret = randomBytes(24).toString('hex');

    await withMachineEnv(h3a, d3a, () => {
      mesh.ensureMeshIdentity();
      mesh.saveMeshConfig({
        machineId: 'win-a',
        displayName: 'Win A',
        transports: {
          http: {
            enabled: true,
            bindHost: '127.0.0.1',
            port: portA,
            peers: { 'mac-b': { url: `http://127.0.0.1:${portB}`, secret: peerSecret } },
          },
          folder: { enabled: false },
          relay: { enabled: false },
        },
      });
    });

    const cfg3b = await withMachineEnv(h3b, d3b, () => {
      mesh.ensureMeshIdentity();
      return mesh.saveMeshConfig({
        machineId: 'mac-b',
        displayName: 'Mac B',
        rateLimitPerMin: 2,
        transports: {
          http: {
            enabled: true,
            bindHost: '127.0.0.1',
            port: portB,
            peers: { 'win-a': { url: `http://127.0.0.1:${portA}`, secret: peerSecret } },
          },
          folder: { enabled: false },
          relay: { enabled: false },
        },
      });
    });

    const spawnDaemon = (homeDir, dataDir) => spawn(process.execPath, [join(root, 'cli', 'mesh-daemon.mjs')], {
      cwd: root,
      env: { ...process.env, USERPROFILE: homeDir, HOME: homeDir, ANTIGRAVITY_IMPLANT_DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const waitHealth = async (url, child) => {
      for (let i = 0; i < 60; i++) {
        if (child.exitCode !== null) return false;
        try {
          const r = await fetch(`${url}/v1/health`);
          if (r.ok) return true;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    };

    const stopDaemon = async (child) => {
      if (!child || child.exitCode !== null) return;
      child.kill();
      await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, 2000))]);
    };

    const daemonA = spawnDaemon(h3a, d3a);
    const daemonB = spawnDaemon(h3b, d3b);
    let errA = '', errB = '';
    daemonA.stderr.on('data', (d) => { errA += d; });
    daemonB.stderr.on('data', (d) => { errB += d; });

    try {
      const upA = await waitHealth(`http://127.0.0.1:${portA}`, daemonA);
      const upB = await waitHealth(`http://127.0.0.1:${portB}`, daemonB);
      const healthB = upB ? await (await fetch(`http://127.0.0.1:${portB}/v1/health`)).json() : null;
      check('3.1 두 격리 머신 mesh-daemon 기동 및 GET /v1/health',
        upA && upB && healthB?.ok === true && healthB?.machineId === 'mac-b',
        `upA=${upA} upB=${upB} errA=${errA} errB=${errB}`);

      // GET /v1/sessions (서명 없음 401 vs 정상 서명 200)
      const unauthSess = await fetch(`http://127.0.0.1:${portB}/v1/sessions`);
      const tsSess = String(Date.now());
      const sigSess = mesh.signHttpRequest({ method: 'GET', path: '/v1/sessions', timestamp: tsSess, machineId: 'win-a', bodyText: '' }, peerSecret);
      const authSess = await fetch(`http://127.0.0.1:${portB}/v1/sessions`, {
        headers: { 'x-mesh-machine': 'win-a', 'x-mesh-timestamp': tsSess, 'x-mesh-signature': sigSess },
      });
      const authSessJson = await authSess.json();
      check('3.2 GET /v1/sessions (서명 없음 401 / 정상 서명 200)',
        unauthSess.status === 401 && authSess.status === 200 && Array.isArray(authSessJson.sessions) && authSessJson.sessions.some((s) => s.id === conv3b),
        `unauth=${unauthSess.status} auth=${authSess.status}`);

      // 정상 전달 200 -> mac-b inbox 적재
      const deliverRes = await withMachineEnv(h3a, d3a, () => mesh.sendMessage({
        fromConversationId: randomUUID(),
        toMachine: 'mac-b',
        toConversationId: conv3b,
        subject: 'HTTP 직접 전달',
        body: 'Tailscale 피어 본문',
        transport: 'http',
      }));
      const bInbox = existsSync(join(d3b, 'mesh', 'inbox', conv3b))
        ? readdirSync(join(d3b, 'mesh', 'inbox', conv3b)).filter((n) => n.endsWith('.json'))
        : [];
      check('3.3 POST /v1/deliver 정상 전달 200 -> 수신함 적재',
        deliverRes.ok && deliverRes.transport === 'http' && bInbox.length === 1,
        JSON.stringify({ deliverRes, bInbox }));

      // 변조 서명 401
      const envForBad = mesh.createEnvelope({ toMachine: 'mac-b', toConversationId: conv3b, body: '서명 변조 테스트' }, { ...cfg3b, machineId: 'win-a', secret: peerSecret });
      const badBody = JSON.stringify({ envelope: envForBad });
      const badTs = String(Date.now());
      const badSigRes = await fetch(`http://127.0.0.1:${portB}/v1/deliver`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-mesh-machine': 'win-a',
          'x-mesh-timestamp': badTs,
          'x-mesh-signature': '0'.repeat(64),
        },
        body: badBody,
      });
      check('3.4 POST /v1/deliver 변조 서명 401 거부', badSigRes.status === 401, String(badSigRes.status));

      // 16KB 초과 413
      const bigBody = JSON.stringify({ envelope: { padding: 'x'.repeat(17000) } });
      const bigTs = String(Date.now());
      const bigSig = mesh.signHttpRequest({ method: 'POST', path: '/v1/deliver', timestamp: bigTs, machineId: 'win-a', bodyText: bigBody }, peerSecret);
      const bigRes = await fetch(`http://127.0.0.1:${portB}/v1/deliver`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-mesh-machine': 'win-a',
          'x-mesh-timestamp': bigTs,
          'x-mesh-signature': bigSig,
        },
        body: bigBody,
      });
      check('3.5 POST /v1/deliver 16KB 초과 413 거부', bigRes.status === 413, String(bigRes.status));

      // rate limit 429 (rateLimitPerMin: 2, 1건은 위 3.3에서 이미 전송됨 -> 2번째 성공, 3번째 429)
      const r2nd = await withMachineEnv(h3a, d3a, () => mesh.sendMessage({
        toMachine: 'mac-b',
        toConversationId: conv3b,
        body: '레이트 리밋 2차',
        transport: 'http',
      }));
      const r3rd = await withMachineEnv(h3a, d3a, () => mesh.sendMessage({
        toMachine: 'mac-b',
        toConversationId: conv3b,
        body: '레이트 리밋 3차',
        transport: 'http',
      }));
      check('3.6 POST /v1/deliver rate limit 429 검증',
        r2nd.ok && !r3rd.ok && r3rd.attempts.some((a) => a.status === 429),
        JSON.stringify({ r2nd, r3rd }));

      // bindHost: '0.0.0.0' 기본 거부 검증
      const hAny = join(tmpRoot, 'h3-any');
      const dAny = join(hAny, '.gemini', 'antigravity-implant');
      mkdirSync(dAny, { recursive: true });
      await withMachineEnv(hAny, dAny, () => {
        mesh.ensureMeshIdentity();
        mesh.saveMeshConfig({
          machineId: 'any-deny',
          transports: { http: { enabled: true, bindHost: '0.0.0.0', port: portB + 1, allowAllInterfaces: false } },
        });
      });
      const denyRun = spawnSync(process.execPath, [join(root, 'cli', 'mesh-daemon.mjs')], {
        cwd: root,
        env: { ...process.env, USERPROFILE: hAny, HOME: hAny, ANTIGRAVITY_IMPLANT_DATA_DIR: dAny },
        encoding: 'utf8',
        timeout: 8000,
      });
      check('3.7 bindHost: 0.0.0.0 allowAllInterfaces/--allow-any 없이 기본 거부',
        denyRun.status !== 0 && /0\.0\.0\.0/.test(denyRun.stderr || ''),
        `status=${denyRun.status} stderr=${denyRun.stderr}`);
    } finally {
      await stopDaemon(daemonA);
      await stopDaemon(daemonB);
    }
  }

  // ============================================================================
  // 4) 공유 폴더 우체통 (Google Drive 모델)
  // ============================================================================
  {
    const sharedSecret = randomBytes(24).toString('hex');
    const { conv: convB, tf: tfB } = makeMainTranscript(homeB, '공유 폴더 수신 세션');

    const cfgA = await withMachineEnv(homeA, dataA, () => {
      mesh.ensureMeshIdentity();
      return mesh.saveMeshConfig({
        machineId: 'win-a',
        transports: {
          http: { enabled: false, peers: { 'mac-b': { url: 'http://127.0.0.1:49999', secret: sharedSecret } } },
          relay: { enabled: false },
          folder: { enabled: true, rootDir: sharedDrive },
        },
      });
    });

    const cfgB = await withMachineEnv(homeB, dataB, () => {
      mesh.ensureMeshIdentity();
      return mesh.saveMeshConfig({
        machineId: 'mac-b',
        transports: {
          http: { enabled: false, peers: { 'win-a': { url: 'http://127.0.0.1:49998', secret: sharedSecret } } },
          relay: { enabled: false },
          folder: { enabled: true, rootDir: sharedDrive },
        },
      });
    });

    await withMachineEnv(homeB, dataB, () => mesh.publishFolderPresence(cfgB));
    const sessionsFromA = await withMachineEnv(homeA, dataA, () => {
      mesh.pollFolderTransport(cfgA);
      return mesh.listAllSessions({ machine: 'mac-b' });
    });
    check('4.1 공유 폴더 publishFolderPresence/pollFolderTransport 원격 세션 발견',
      sessionsFromA.some((s) => s.id === convB && s.machineId === 'mac-b'),
      JSON.stringify(sessionsFromA));

    const sendRes = await withMachineEnv(homeA, dataA, () => mesh.sendMessage({
      fromConversationId: randomUUID(),
      toMachine: 'mac-b',
      toConversationId: convB,
      subject: '드라이브 메모',
      body: '공유 폴더 첫 메시지',
      transport: 'folder',
    }));
    const folderInboxDir = join(sharedDrive, 'mesh-v1', 'inbox', 'mac-b');
    const queuedFiles = readdirSync(folderInboxDir).filter((n) => n.endsWith('.json'));
    const rawCopy = queuedFiles.length ? readFileSync(join(folderInboxDir, queuedFiles[0]), 'utf8') : '';

    const poll1 = await withMachineEnv(homeB, dataB, () => mesh.pollFolderTransport(cfgB));
    // 동일 파일 재투입 후 중복 방지(seen) 검증
    if (rawCopy) writeFileSync(join(folderInboxDir, `dup-${queuedFiles[0]}`), rawCopy, 'utf8');
    const poll2 = await withMachineEnv(homeB, dataB, () => mesh.pollFolderTransport(cfgB));
    check('4.2 공유 폴더 수신 및 중복(seen) 방지',
      sendRes.ok && poll1.received === 1 && poll2.received === 0 && poll2.duplicates === 1,
      JSON.stringify({ sendRes, poll1, poll2 }));

    // B 수신함 비운 뒤, 데몬 없이 pre_invocation.mjs 단독 폴백 수거 검증
    await withMachineEnv(homeB, dataB, () => mesh.drainInboxForConversation(convB, { maxMessages: 10, ingestFolder: false }));
    rmSync(join(dataB, 'mesh', 'daemon.pid'), { force: true });

    await withMachineEnv(homeA, dataA, () => mesh.sendMessage({
      toMachine: 'mac-b',
      toConversationId: convB,
      body: '데몬 없이 훅 폴백 수거 확인',
      transport: 'folder',
    }));

    const hookPoll = runPreInvocation(homeB, dataB, {
      conversationId: convB,
      transcriptPath: tfB,
      modelName: 'gemini-4-carbon-high',
      invocationNum: 0,
    });
    const hookText = injectedTexts(hookPoll.out);
    check('4.3 데몬 없이 pre_invocation.mjs 단독 실행 시 공유 폴더 폴백 수거',
      hookPoll.code === 0 && /\[세션 간 메시지/.test(hookText) && /데몬 없이 훅 폴백 수거 확인/.test(hookText),
      hookText.slice(0, 300));
  }

  // ============================================================================
  // 5) 클라우드 중계 서버 (relay/node-relay/server.mjs)
  // ============================================================================
  {
    const { createRelayServer } = await import(pathToFileURL(join(root, 'relay', 'node-relay', 'server.mjs')).href);
    const h5a = join(tmpRoot, 'h5-a');
    const h5b = join(tmpRoot, 'h5-b');
    const d5a = join(h5a, '.gemini', 'antigravity-implant');
    const d5b = join(h5b, '.gemini', 'antigravity-implant');
    const relayData = join(tmpRoot, 'relay-data');
    mkdirSync(d5a, { recursive: true });
    mkdirSync(d5b, { recursive: true });
    mkdirSync(relayData, { recursive: true });

    const { conv: conv5a } = makeMainTranscript(h5a, 'Relay 송신 세션');
    const { conv: conv5b } = makeMainTranscript(h5b, 'Relay 수신 세션');
    const relayPort = await getFreePort();
    const relaySecret = randomBytes(24).toString('hex');
    const relayUrl = `http://127.0.0.1:${relayPort}`;

    const relaySrv = createRelayServer({ secret: relaySecret, host: '127.0.0.1', port: relayPort, dataDir: relayData });
    await once(relaySrv, 'listening');

    try {
      const cfg5a = await withMachineEnv(h5a, d5a, () => {
        mesh.ensureMeshIdentity();
        return mesh.saveMeshConfig({
          machineId: 'win-a',
          transports: { http: { enabled: false }, folder: { enabled: false }, relay: { enabled: true, url: relayUrl, secret: relaySecret } },
        });
      });
      const cfg5b = await withMachineEnv(h5b, d5b, () => {
        mesh.ensureMeshIdentity();
        return mesh.saveMeshConfig({
          machineId: 'mac-b',
          transports: { http: { enabled: false }, folder: { enabled: false }, relay: { enabled: true, url: relayUrl, secret: relaySecret } },
        });
      });

      const rHealth = await (await fetch(`${relayUrl}/v1/health`)).json();
      check('5.1 Node Relay GET /v1/health 200', rHealth?.ok === true && rHealth?.service === 'antigravity-mesh-relay', JSON.stringify(rHealth));

      // B 오프라인 중 A 전송
      const send5 = await withMachineEnv(h5a, d5a, () => mesh.sendMessage({
        fromConversationId: conv5a,
        toMachine: 'mac-b',
        toConversationId: conv5b,
        subject: '오프라인 중계',
        body: 'B가 오프라인일 때 보낸 메시지',
        transport: 'relay',
      }));
      check('5.2 Node Relay B 오프라인 중 A 전송 성공', send5.ok && send5.transport === 'relay', JSON.stringify(send5));

      // A presence 등록 후 B가 pull + ack + 2차 pull 빈 배열 + presence 조회
      const pub5 = await withMachineEnv(h5a, d5a, () => mesh.publishRelayPresence(cfg5a));
      const pull5 = await withMachineEnv(h5b, d5b, () => mesh.pollRelayTransport(cfg5b));

      const ts2 = String(Date.now());
      const sig2 = mesh.signHttpRequest({ method: 'GET', path: '/v1/pull', timestamp: ts2, machineId: 'mac-b', bodyText: '' }, relaySecret);
      const secondPull = await (await fetch(`${relayUrl}/v1/pull?machine=mac-b&limit=20`, {
        headers: { 'x-mesh-machine': 'mac-b', 'x-mesh-timestamp': ts2, 'x-mesh-signature': sig2 },
      })).json();

      const tsPres = String(Date.now());
      const sigPres = mesh.signHttpRequest({ method: 'GET', path: '/v1/presence', timestamp: tsPres, machineId: 'mac-b', bodyText: '' }, relaySecret);
      const presRes = await (await fetch(`${relayUrl}/v1/presence`, {
        headers: { 'x-mesh-machine': 'mac-b', 'x-mesh-timestamp': tsPres, 'x-mesh-signature': sigPres },
      })).json();

      check('5.3 Node Relay B pull+ack -> 2차 pull 빈 배열 -> presence 조회',
        pub5.ok && pull5.ok && pull5.received === 1 && pull5.acked === 1
        && Array.isArray(secondPull.items) && secondPull.items.length === 0
        && Boolean(presRes.machines?.['win-a']?.sessions?.some((s) => s.id === conv5a)),
        JSON.stringify({ pub5, pull5, secondPull, presRes }));

      // 잘못된 서명 401
      const badPull = await fetch(`${relayUrl}/v1/pull?machine=mac-b`, {
        headers: { 'x-mesh-machine': 'mac-b', 'x-mesh-timestamp': String(Date.now()), 'x-mesh-signature': 'f'.repeat(64) },
      });
      check('5.4 Node Relay 잘못된 서명 401 거부', badPull.status === 401, String(badPull.status));

      // 타 머신 inbox pull/ack 403 거부
      const tsCrossPull = String(Date.now());
      const sigCrossPull = mesh.signHttpRequest({ method: 'GET', path: '/v1/pull', timestamp: tsCrossPull, machineId: 'mac-b', bodyText: '' }, relaySecret);
      const crossPull = await fetch(`${relayUrl}/v1/pull?machine=win-a`, {
        headers: { 'x-mesh-machine': 'mac-b', 'x-mesh-timestamp': tsCrossPull, 'x-mesh-signature': sigCrossPull },
      });

      const ackBody = JSON.stringify({ machineId: 'win-a', ids: ['fake-id'] });
      const tsCrossAck = String(Date.now());
      const sigCrossAck = mesh.signHttpRequest({ method: 'POST', path: '/v1/ack', timestamp: tsCrossAck, machineId: 'mac-b', bodyText: ackBody }, relaySecret);
      const crossAck = await fetch(`${relayUrl}/v1/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mesh-machine': 'mac-b', 'x-mesh-timestamp': tsCrossAck, 'x-mesh-signature': sigCrossAck },
        body: ackBody,
      });
      check('5.5 Node Relay 타 머신 inbox pull/ack 403 거부',
        crossPull.status === 403 && crossAck.status === 403,
        `pull=${crossPull.status} ack=${crossAck.status}`);
    } finally {
      await new Promise((r) => relaySrv.close(r));
    }
  }

  // ============================================================================
  // 6) 자동 폴백 라우팅 (HTTP 실패 -> Relay 성공 / Relay도 실패 -> Folder 성공)
  // ============================================================================
  {
    const deadHttpPort = await getFreePort();
    const deadRelayPort = await getFreePort();
    const relayPort = await getFreePort();
    const relaySecret = 'fallback-relay-secret';
    let relayHits = 0;

    const stubRelay = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/send') {
        relayHits++;
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, id: parsed.envelope?.id || 'ok', queued: 1 }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((r) => stubRelay.listen(relayPort, '127.0.0.1', r));

    try {
      await withMachineEnv(homeA, dataA, () => mesh.saveMeshConfig({
        machineId: 'win-a',
        transports: {
          http: { enabled: true, peers: { 'mac-b': { url: `http://127.0.0.1:${deadHttpPort}`, secret: 'x' } } },
          relay: { enabled: true, url: `http://127.0.0.1:${relayPort}`, secret: relaySecret },
          folder: { enabled: true, rootDir: sharedDrive },
        },
      }));

      const resRelay = await withMachineEnv(homeA, dataA, () => mesh.sendMessage({
        toMachine: 'mac-b',
        toConversationId: 'latest',
        body: 'HTTP 실패 후 Relay 폴백',
        transport: 'auto',
      }));
      check('6.1 자동 폴백: HTTP 피어 실패 -> Relay 성공',
        resRelay.ok && resRelay.transport === 'relay' && relayHits === 1
        && resRelay.attempts.some((a) => a.transport === 'http' && !a.ok)
        && resRelay.attempts.some((a) => a.transport === 'relay' && a.ok),
        JSON.stringify(resRelay));

      await withMachineEnv(homeA, dataA, () => mesh.saveMeshConfig({
        transports: {
          relay: { enabled: true, url: `http://127.0.0.1:${deadRelayPort}`, secret: relaySecret },
        },
      }));

      const resFolder = await withMachineEnv(homeA, dataA, () => mesh.sendMessage({
        toMachine: 'mac-b',
        toConversationId: 'latest',
        body: 'HTTP/Relay 실패 후 Folder 폴백',
        transport: 'auto',
      }));
      check('6.2 자동 폴백: HTTP & Relay 모두 실패 -> Folder 성공',
        resFolder.ok && resFolder.transport === 'folder'
        && resFolder.attempts.some((a) => a.transport === 'http' && !a.ok)
        && resFolder.attempts.some((a) => a.transport === 'relay' && !a.ok)
        && resFolder.attempts.some((a) => a.transport === 'folder' && a.ok),
        JSON.stringify(resFolder));
    } finally {
      await new Promise((r) => stubRelay.close(r));
    }
  }

  // ============================================================================
  // 7) Cloudflare Worker 단위 테스트 (relay/cloudflare-worker/worker.js)
  // ============================================================================
  {
    const workerMod = await import(pathToFileURL(join(root, 'relay', 'cloudflare-worker', 'worker.js')).href);
    const { MeshHub, default: workerDefault } = workerMod;

    const memStore = new Map();
    const mockState = {
      storage: {
        async get(key) {
          const v = memStore.get(key);
          return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
        },
        async put(key, val) {
          memStore.set(key, JSON.parse(JSON.stringify(val)));
        },
      },
    };
    const workerSecret = randomBytes(24).toString('hex');
    const hub = new MeshHub(mockState, { MESH_SECRET: workerSecret });
    const mockEnv = {
      MESH_HUB: {
        idFromName: () => 'global',
        get: () => hub,
      },
    };

    const callWorker = async (method, pathAndQuery, { machineId = 'win-a', bodyObj, secret = workerSecret, badSig = false } = {}) => {
      const url = `https://relay.example.test${pathAndQuery}`;
      const pathname = new URL(url).pathname;
      const bodyText = bodyObj !== undefined ? JSON.stringify(bodyObj) : '';
      const ts = String(Date.now());
      const sig = badSig
        ? 'a'.repeat(64)
        : mesh.signHttpRequest({ method, path: pathname, timestamp: ts, machineId, bodyText }, secret);
      const headers = new Headers({
        'x-mesh-machine': machineId,
        'x-mesh-timestamp': ts,
        'x-mesh-signature': sig,
        ...(bodyObj !== undefined ? { 'content-type': 'application/json' } : {}),
      });
      const req = new Request(url, { method, headers, ...(bodyObj !== undefined ? { body: bodyText } : {}) });
      const res = await workerDefault.fetch(req, mockEnv);
      const json = await res.json();
      return { status: res.status, json };
    };

    const wHealth = await workerDefault.fetch(new Request('https://relay.example.test/v1/health'), mockEnv);
    const wHealthJson = await wHealth.json();
    check('7.1 Worker GET /v1/health 200', wHealth.status === 200 && wHealthJson.ok === true, JSON.stringify(wHealthJson));

    const wEnv = mesh.createEnvelope({ toMachine: 'mac-b', toConversationId: 'latest', body: 'Worker 중계 본문' }, {
      machineId: 'win-a', displayName: 'Win A', secret: workerSecret, maxHops: 4, maxBodyChars: 4000,
    });
    const wSend = await callWorker('POST', '/v1/send', { machineId: 'win-a', bodyObj: { envelope: wEnv } });
    const wPull1 = await callWorker('GET', '/v1/pull?machine=mac-b&limit=20', { machineId: 'mac-b' });
    const wAck = await callWorker('POST', '/v1/ack', { machineId: 'mac-b', bodyObj: { machineId: 'mac-b', ids: [wEnv.id] } });
    const wPull2 = await callWorker('GET', '/v1/pull?machine=mac-b&limit=20', { machineId: 'mac-b' });
    check('7.2 Worker POST /v1/send -> GET /v1/pull -> POST /v1/ack -> 빈 pull',
      wSend.status === 200 && wSend.json.queued === 1
      && wPull1.status === 200 && wPull1.json.items.length === 1 && wPull1.json.items[0].envelope.body === 'Worker 중계 본문'
      && wAck.status === 200 && wAck.json.removed === 1
      && wPull2.status === 200 && wPull2.json.items.length === 0,
      JSON.stringify({ wSend, wPull1, wAck, wPull2 }));

    const wPresPost = await callWorker('POST', '/v1/presence', {
      machineId: 'win-a',
      bodyObj: { machineId: 'win-a', displayName: 'Win A', sessions: [{ id: '11111111-2222-3333-4444-555555555555' }] },
    });
    const wPresGet = await callWorker('GET', '/v1/presence', { machineId: 'mac-b' });
    check('7.3 Worker POST/GET /v1/presence',
      wPresPost.status === 200 && wPresGet.status === 200 && Boolean(wPresGet.json.machines?.['win-a']),
      JSON.stringify({ wPresPost, wPresGet }));

    const wBadSig = await callWorker('GET', '/v1/pull?machine=mac-b', { machineId: 'mac-b', badSig: true });
    const wCrossPull = await callWorker('GET', '/v1/pull?machine=win-a', { machineId: 'mac-b' });
    const wCrossAck = await callWorker('POST', '/v1/ack', { machineId: 'mac-b', bodyObj: { machineId: 'win-a', ids: ['x'] } });
    check('7.4 Worker 잘못된 서명 401 & 타 머신 403 거부',
      wBadSig.status === 401 && wCrossPull.status === 403 && wCrossAck.status === 403,
      `badSig=${wBadSig.status} crossPull=${wCrossPull.status} crossAck=${wCrossAck.status}`);
  }

  // ============================================================================
  // 8) MCP Stdio 프로토콜 E2E (mcp/session-bridge.mjs)
  // ============================================================================
  {
    const { conv: mcpConv } = makeMainTranscript(homeA, 'MCP E2E 대상 세션');
    await withMachineEnv(homeA, dataA, () => mesh.saveMeshConfig({
      machineId: 'win-a',
      transports: { http: { enabled: false }, relay: { enabled: false }, folder: { enabled: false } },
    }));

    const child = spawn(process.execPath, [join(root, 'mcp', 'session-bridge.mjs')], {
      cwd: root,
      env: { ...process.env, USERPROFILE: homeA, HOME: homeA, ANTIGRAVITY_IMPLANT_DATA_DIR: dataA },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    const responses = new Map();
    const waiters = new Map();
    let pureJsonRpc = true;
    const badLines = [];

    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString('utf8');
      let nl;
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.jsonrpc !== '2.0') { pureJsonRpc = false; badLines.push(line); }
          if (msg.id !== undefined && msg.id !== null) {
            responses.set(msg.id, msg);
            if (waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
          }
        } catch {
          pureJsonRpc = false;
          badLines.push(line);
        }
      }
    });
    child.stderr.on('data', (d) => { stderrBuf += d.toString('utf8'); });

    const rpc = (id, method, params) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP timeout for ${method} (id=${id})`)), 8000);
      waiters.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n');
    });

    try {
      const initRes = await rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

      const listRes = await rpc(2, 'tools/list');
      const toolNames = (listRes.result?.tools || []).map((t) => t.name);
      const hasAll5 = ['mesh_status', 'mesh_list_sessions', 'mesh_send', 'mesh_inbox', 'mesh_sync_now'].every((n) => toolNames.includes(n));

      const statusRes = await rpc(3, 'tools/call', { name: 'mesh_status', arguments: {} });
      const statusData = JSON.parse(statusRes.result?.content?.[0]?.text || '{}');

      const sessRes = await rpc(4, 'tools/call', { name: 'mesh_list_sessions', arguments: { machine: 'local' } });
      const sessData = JSON.parse(sessRes.result?.content?.[0]?.text || '{}');

      const sendRes = await rpc(5, 'tools/call', {
        name: 'mesh_send',
        arguments: { toMachine: 'local', toConversationId: mcpConv, subject: 'MCP테스트', body: 'MCP로 보낸 메시지' },
      });
      const sendData = JSON.parse(sendRes.result?.content?.[0]?.text || '{}');

      const inboxRes = await rpc(6, 'tools/call', {
        name: 'mesh_inbox',
        arguments: { conversationId: mcpConv, drain: true },
      });
      const inboxData = JSON.parse(inboxRes.result?.content?.[0]?.text || '{}');

      // Content-Length 프레이밍도 동작하는지 확인
      const pingBody = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' });
      const clFrame = `Content-Length: ${Buffer.byteLength(pingBody, 'utf8')}\r\n\r\n${pingBody}`;
      const pingRes = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('MCP Content-Length timeout')), 8000);
        waiters.set(7, (msg) => { clearTimeout(timer); resolve(msg); });
        child.stdin.write(clFrame);
      });

      child.stdin.end();
      await new Promise((r) => child.on('exit', r));

      check('8.1 MCP initialize & tools/list 5종 도구 확인',
        initRes.result?.serverInfo?.name === 'session-bridge' && toolNames.length === 5 && hasAll5,
        JSON.stringify({ initRes, toolNames }));
      check('8.2 MCP tools/call (status, list_sessions, send, inbox, ping)',
        statusData.machineId === 'win-a'
        && !statusRes.result?.content?.[0]?.text.includes('relay-top-secret-value')
        && Array.isArray(sessData.sessions) && sessData.sessions.some((s) => s.id === mcpConv)
        && sendData.ok === true
        && Array.isArray(inboxData.drained) && inboxData.drained.some((m) => m.body === 'MCP로 보낸 메시지')
        && pingRes.result && typeof pingRes.result === 'object',
        JSON.stringify({ statusData, sendData, inboxData, pingRes }));
      check('8.3 MCP stdout 순수 JSON-RPC 출력 검증', pureJsonRpc && badLines.length === 0, badLines.join(' | ') + ' stderr=' + stderrBuf);
    } finally {
      if (!child.killed) child.kill();
    }
  }

  // ============================================================================
  // 9) Live Cockpit 사이드카 Mesh API (sidecars/live-cockpit/main.mjs)
  // ============================================================================
  {
    const sdkDirs = [
      process.env.ANTIGRAVITY_SIDECAR_SDK_DIR,
      join(root, 'sidecars', 'live-cockpit', 'sdk'),
    ].filter(Boolean);
    if (!sdkDirs.some((d) => existsSync(join(d, 'index.mjs')))) {
      console.log('SKIP  Antigravity 의 sidecar_sdk 가 없어 사이드카 Mesh API 시험을 건너뜀');
    } else {
      const h9 = join(tmpRoot, 'h9');
      const d9 = join(h9, '.gemini', 'antigravity-implant');
      mkdirSync(d9, { recursive: true });
      const { conv: conv9 } = makeMainTranscript(h9, '사이드카 메쉬 테스트 세션');

      const topSec9 = 'cockpit-top-secret-999';
      const relaySec9 = 'cockpit-relay-secret-999';
      const peerSec9 = 'cockpit-peer-secret-999';
      await withMachineEnv(h9, d9, () => {
        mesh.ensureMeshIdentity();
        return mesh.saveMeshConfig({
          machineId: 'cockpit-a',
          displayName: 'Cockpit A',
          secret: topSec9,
          transports: {
            http: { enabled: true, peers: { 'mac-b': { url: 'http://127.0.0.1:47900', secret: peerSec9 } } },
            relay: { enabled: true, url: 'http://127.0.0.1:8790', secret: relaySec9 },
          },
        });
      });

      const token9 = 'mesh-ui-token-' + randomUUID();
      const authHeaders = { 'Content-Type': 'application/json', 'X-Sidecar-Token': token9 };
      let srv = null, srvErr = '', port = 0, base = '', up = false;

      for (let attempt = 0; attempt < 3 && !up; attempt++) {
        port = await getFreePort();
        srvErr = '';
        srv = spawn(process.execPath, ['main.mjs'], {
          cwd: join(root, 'sidecars', 'live-cockpit'),
          env: {
            ...process.env,
            USERPROFILE: h9,
            HOME: h9,
            ANTIGRAVITY_IMPLANT_DATA_DIR: d9,
            ANTIGRAVITY_SIDECAR_UI_TOKEN: token9,
            ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:1',
            ANTIGRAVITY_CSRF_TOKEN: 'x',
            ANTIGRAVITY_SIDECAR_WEB_PORT: String(port),
          },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        srv.stderr.on('data', (d) => { srvErr += d; });
        base = `http://127.0.0.1:${port}`;
        for (let i = 0; i < 80 && !up; i++) {
          await new Promise((r) => setTimeout(r, 200));
          try { up = (await fetch(`${base}/api/conversations`)).ok; } catch {}
          if (srv.exitCode != null) break;
        }
        if (!up) {
          srv.kill();
          await Promise.race([once(srv, 'exit'), new Promise((r) => setTimeout(r, 1500))]);
        }
      }

      check('9.1 Live Cockpit 사이드카 기동', up, srvErr.slice(0, 500));

      if (up) {
        try {
          const stRaw = await (await fetch(`${base}/api/mesh/status`)).text();
          const stJson = JSON.parse(stRaw);
          check('9.2 GET /api/mesh/status 비밀키 미포함 및 마스킹 검증',
            stJson.machineId === 'cockpit-a'
            && !stRaw.includes(topSec9)
            && !stRaw.includes(relaySec9)
            && !stRaw.includes(peerSec9)
            && stJson.config?.secretConfigured === true
            && stJson.config?.transports?.relay?.secretConfigured === true
            && stJson.config?.transports?.http?.peers?.['mac-b']?.secretConfigured === true,
            stRaw.slice(0, 400));

          const cfgNoTok = await fetch(`${base}/api/mesh/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName: 'Unauthorized' }),
          });
          const newRelaySec = 'cockpit-new-relay-secret-777';
          const cfgOkRes = await fetch(`${base}/api/mesh/config`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              displayName: 'Cockpit Updated',
              transports: {
                folder: { enabled: true, rootDir: sharedDrive },
                relay: { enabled: true, url: 'http://127.0.0.1:8791', secret: newRelaySec },
              },
            }),
          });
          const cfgOkRaw = await cfgOkRes.text();
          const cfgOkJson = JSON.parse(cfgOkRaw);
          const stAfterRaw = await (await fetch(`${base}/api/mesh/status`)).text();
          const stAfterJson = JSON.parse(stAfterRaw);
          check('9.3 POST /api/mesh/config 토큰 401 차단, 저장 및 재조회 마스킹 유지',
            cfgNoTok.status === 401
            && cfgOkRes.status === 200 && cfgOkJson.ok === true
            && !cfgOkRaw.includes(newRelaySec)
            && !stAfterRaw.includes(newRelaySec)
            && !stAfterRaw.includes(topSec9)
            && stAfterJson.config?.displayName === 'Cockpit Updated'
            && stAfterJson.config?.transports?.folder?.enabled === true
            && stAfterJson.config?.transports?.relay?.secretConfigured === true,
            `noTok=${cfgNoTok.status} ok=${cfgOkRes.status} after=${stAfterRaw.slice(0, 300)}`);

          const sendNoTok = await fetch(`${base}/api/mesh/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toMachine: 'local', toConversationId: conv9, body: 'no token' }),
          });
          const sendOkRes = await fetch(`${base}/api/mesh/send`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              toMachine: 'local',
              toConversationId: conv9,
              subject: '패널 테스트',
              body: '사이드카 API 전송 본문',
              wake: true,
              transport: 'local',
            }),
          });
          const sendOkJson = await sendOkRes.json();
          const stSent = await (await fetch(`${base}/api/mesh/status`)).json();
          check('9.4 POST /api/mesh/send 토큰 401 차단 및 로컬 전송 성공',
            sendNoTok.status === 401
            && sendOkRes.status === 200 && sendOkJson.ok === true && sendOkJson.transport === 'local'
            && Array.isArray(stSent.history) && stSent.history.some((h) => h.body === '사이드카 API 전송 본문'),
            `noTok=${sendNoTok.status} ok=${sendOkRes.status} res=${JSON.stringify(sendOkJson)}`);
        } finally {
          srv.kill();
          await Promise.race([once(srv, 'exit'), new Promise((r) => setTimeout(r, 2000))]);
        }
      }
    }
  }
} finally {
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

console.log(fails ? `\n${fails}개 실패` : '\n전부 통과');
process.exitCode = fails ? 1 : 0;
