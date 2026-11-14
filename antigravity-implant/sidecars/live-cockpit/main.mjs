// Live Cockpit 사이드카: 대화 옆 패널에 "지금 무엇을 하는지"를 모델과 상관없이 보여준다.
// 읽기: 대화 기록·스크린샷·훅 상태·git 변경. 쓰기: 사용자가 누른 것만(실시간 규칙 저장, 일시정지, 되돌리기, 모드 프리셋).
// SDK 는 Antigravity 앱이 깔아 둔 것을 찾아 쓴다(아래 SDK_CANDIDATES). 일부 PC 에서는 앱이 "node" 명령을 자기 실행 파일로 바꿔 띄우다
// 한글 경로 때문에 실패하므로 sidecar.json 은 "node.exe" 를 쓰고, 앱의 'sidecar_sdk' 로더 없이 뜨게 한다.
// SDK 는 127.0.0.1 에만 묶이고, 토큰이 설정되면 POST 요청의 토큰을 검사한다.
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, openSync, readSync, fstatSync, closeSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import http from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
// SDK 는 Google 이 앱과 함께 깔아 주는 것을 쓴다 (이 저장소에 넣지 않음). 플러그인 안 sdk/ 사본이 있으면 그것 먼저.
const SDK_CANDIDATES = [
  ...(process.env.ANTIGRAVITY_SIDECAR_SDK_DIR ? [join(process.env.ANTIGRAVITY_SIDECAR_SDK_DIR, 'index.mjs')] : []),
  join(here, 'sdk', 'index.mjs'),
  join(homedir(), '.gemini', 'config', 'node_modules', 'sidecar_sdk', 'index.mjs'),
  join(homedir(), '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk', 'index.mjs'),
];
const sdkPath = SDK_CANDIDATES.find((p) => existsSync(p));
if (!sdkPath) { process.stderr.write('live-cockpit: sidecar_sdk 를 찾지 못했습니다. Antigravity 앱을 한 번 실행한 뒤 다시 시도하세요.\n'); process.exit(1); }
const { SidecarApp, Response } = await import(pathToFileURL(sdkPath).href);
const PLUGIN_ROOT = resolve(here, '..', '..');
const HOME = homedir();
const ID_RE = /^[0-9a-zA-Z-]{8,64}$/;
const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
// 데이터 폴더·원자적 저장은 훅과 같은 코드를 쓴다 (옛 이름 폴더 자동 이전도 여기서 같이 일어남)
const { DATA_DIR, atomicWrite } = await import(pathToFileURL(join(PLUGIN_ROOT, 'hooks', 'lib', 'common.mjs')).href);
const STATE_DIR = join(DATA_DIR, 'state');
const CP_ID_RE = /^[\w.-]{1,80}$/; // 체크포인트 번호 또는 id (빈 값·옵션처럼 생긴 값 거부)
const LIVE_RULES = join(HOME, '.gemini', 'config', 'live_rules.md');
const LIVE_RULES_TEMPLATE = `<!--
실시간 규칙: 여기 적은 내용은 저장하는 즉시 "다음 모델 호출"부터 적용됩니다.
작업 도중에도 바로 반영됩니다. 이 주석은 무시됩니다. 비워 두면 아무것도 넣지 않습니다.
예) 지금부터 CSS는 건드리지 마.
-->
`;

// ---------- 요청 보호 ----------
// 1) 토큰: 앱이 ANTIGRAVITY_SIDECAR_UI_TOKEN 을 주면 SDK 가 모든 POST 에서 검사한다. 안 주면(직접 실행 등) 무방비가 되므로
//    여기서 무작위 토큰을 만들어 건다 — 다른 웹페이지가 몰래 POST(규칙 쓰기·되돌리기·메시지 보내기)를 보내지 못하게.
//    패널 페이지에는 그 토큰을 넣어 주고, preload 가 읽도록 주소에 ?token= 을 붙인다.
if (!process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN) process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN = randomBytes(24).toString('hex');
const UI_TOKEN = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN;
// 2) 호스트 이름: 127.0.0.1 / localhost 로 온 요청만 받는다 (DNS rebinding 으로 다른 사이트가 페이지·토큰을 읽는 것 방지)
const ORIG_EMIT = http.Server.prototype.emit;
http.Server.prototype.emit = function (ev, req, res) {
  if (ev === 'request' && req && res) {
    const host = String(req.headers.host || '').toLowerCase();
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('forbidden host'); return true;
    }
  }
  return ORIG_EMIT.apply(this, arguments);
};

const app = new SidecarApp();

// ---------- 공통 ----------
const jsonError = (msg, status = 400) => new Response(JSON.stringify({ error: msg }), { status, contentType: 'application/json' });
function fileStamp(f) { try { return statSync(f).mtimeMs; } catch { return 0; } }

function brainDirs() {
  const out = [];
  const dataDir = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (dataDir) out.push(join(dataDir, '..', '..', '..', '..', 'brain'));
  for (const p of ['antigravity', 'antigravity-cli', 'antigravity-ide']) out.push(join(HOME, '.gemini', p, 'brain'));
  return [...new Set(out)].filter((d) => existsSync(d));
}

function convDir(conv) {
  if (!conv || !ID_RE.test(conv)) return null;
  for (const b of brainDirs()) {
    const d = join(b, conv);
    if (existsSync(join(d, '.system_generated', 'logs'))) return d;
  }
  return null;
}

function transcriptOf(dir) {
  const logs = join(dir, '.system_generated', 'logs');
  for (const n of ['transcript_full.jsonl', 'transcript.jsonl']) if (existsSync(join(logs, n))) return join(logs, n);
  return null;
}

function readTail(file, bytes) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    const n = readSync(fd, buf, 0, buf.length, start);
    let text = buf.subarray(0, n).toString('utf8');
    if (start > 0) { const i = text.indexOf('\n'); text = i < 0 ? '' : text.slice(i + 1); }
    return text;
  } finally { closeSync(fd); }
}

function readFirstLine(file) {
  const fd = openSync(file, 'r');
  try {
    const chunks = [];
    let pos = 0;
    while (pos < 4 * 1024 * 1024) {
      const buf = Buffer.alloc(65536);
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (!n) break;
      const nl = buf.subarray(0, n).indexOf(10);
      if (nl >= 0) { chunks.push(buf.subarray(0, nl)); break; }
      chunks.push(buf.subarray(0, n)); pos += n;
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
  } finally { closeSync(fd); }
}

function parse(text) {
  const out = [];
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch {} }
  return out;
}

const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };
const stripUser = (s) => { const m = String(s).match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/); return (m ? m[1] : String(s)).trim(); };
const loadHookState = (conv) => { try { return JSON.parse(readFileSync(join(STATE_DIR, conv + '.json'), 'utf8')) || {}; } catch { return {}; } };

function argSummary(args) {
  if (!args || typeof args !== 'object') return '';
  for (const k of ['toolSummary', 'CommandLine', 'Path', 'AbsolutePath', 'TargetFile', 'File', 'Url', 'URL', 'Query', 'SearchPath', 'DirectoryPath', 'ToolName', 'Prompt', 'Task', 'TaskName', 'Message']) {
    if (args[k]) return `${k}: ${clip(typeof args[k] === 'string' ? args[k] : JSON.stringify(args[k]), 140)}`;
  }
  const first = Object.entries(args)[0];
  return first ? `${first[0]}: ${clip(typeof first[1] === 'string' ? first[1] : JSON.stringify(first[1]), 120)}` : '';
}

function simplify(s) {
  const base = { i: s.step_index, type: s.type, status: s.status, at: s.created_at };
  switch (s.type) {
    case 'USER_INPUT': return { ...base, kind: 'user', text: clip(stripUser(s.content), 600) };
    case 'PLANNER_RESPONSE': return {
      ...base, kind: 'model',
      text: clip(s.content, 1200),
      thinking: clip(String(s.thinking || '').split('\n').find((l) => l.trim()) || '', 220),
      tools: (s.tool_calls || []).map((t) => ({ name: t.name, arg: argSummary(t.args) })),
    };
    case 'GENERIC': return { ...base, kind: 'result', error: s.status === 'ERROR', text: clip(String(s.content || '').replace(/^(Created At|Completed At):.*\n/gm, ''), 240) };
    case 'SYSTEM_MESSAGE': case 'EPHEMERAL_MESSAGE': return { ...base, kind: 'system', text: clip(String(s.content || '').replace(/^The following is a <SYSTEM_MESSAGE>[\s\S]*?<SYSTEM_MESSAGE>\s*/, ''), 300) };
    case 'CHECKPOINT': return { ...base, kind: 'checkpoint', text: '대화 기록 압축(체크포인트)' };
    default: return { ...base, kind: 'other', text: clip(s.content, 200) };
  }
}

function listImages(dir) {
  const out = [];
  const media = join(dir, '.system_generated', 'logs', 'media');
  try { for (const n of readdirSync(media)) if (IMG_RE.test(n)) out.push({ src: 'media', name: n, mtime: statSync(join(media, n)).mtimeMs }); } catch {}
  try { for (const n of readdirSync(dir)) if (IMG_RE.test(n)) out.push({ src: 'artifact', name: n, mtime: statSync(join(dir, n)).mtimeMs }); } catch {}
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 24);
}

// 백그라운드 작업 (.system_generated/tasks/*.log) — 최근 5개만 읽는다
function readTasks(dir) {
  const td = join(dir, '.system_generated', 'tasks');
  try {
    return readdirSync(td).filter((n) => n.endsWith('.log'))
      .map((n) => { const f = join(td, n); try { const st = statSync(f); return { n, f, mtime: st.mtimeMs, size: st.size }; } catch { return null; } })
      .filter(Boolean).sort((a, b) => b.mtime - a.mtime).slice(0, 5)
      .map((t) => {
        let last = '';
        try { last = readTail(t.f, 4096).trim().split('\n').filter(Boolean).pop() || ''; } catch {}
        return { name: t.n.replace(/\.log$/, ''), mtime: t.mtime, size: t.size, last: clip(last, 160) };
      });
  } catch { return []; }
}

// 에이전트가 쓴 작업 목록(task.md)과 계획(implementation_plan.md)
function readPlan(dir) {
  const out = {};
  for (const [k, n] of [['task', 'task.md'], ['plan', 'implementation_plan.md']]) {
    const f = join(dir, n);
    if (!existsSync(f)) continue;
    try {
      const text = readFileSync(f, 'utf8').slice(0, 30000);
      const done = (text.match(/^\s*[-*]\s+\[[xX]\]/gm) || []).length;
      const open = (text.match(/^\s*[-*]\s+\[\s\]/gm) || []).length;
      const doing = (text.match(/^\s*[-*]\s+\[\/\]/gm) || []).length;
      out[k] = { text, done, total: done + open + doing, mtime: statSync(f).mtimeMs };
    } catch {}
  }
  return out;
}

// 이번 대화의 토큰 합계 (모델 호출마다의 입력·출력 합). 늘어난 부분만 이어서 읽는다(한 번에 최대 4MB). 캐시는 대화 20개까지.
const usageCache = new Map();
function usageOf(tf) {
  let size = 0;
  try { size = statSync(tf).size; } catch { return null; }
  let c = usageCache.get(tf);
  if (c && c.offset === size) return c.usage;
  if (!c || size < c.offset) c = { offset: 0, usage: { calls: 0, input: 0, cached: 0, output: 0 } }; // 처음이거나 파일이 줄었으면 처음부터
  try {
    const fd = openSync(tf, 'r');
    try {
      const len = Math.min(size - c.offset, 4 * 1024 * 1024);
      const buf = Buffer.alloc(len);
      const n = readSync(fd, buf, 0, len, c.offset);
      const text = buf.subarray(0, n).toString('utf8');
      const lastNl = text.lastIndexOf('\n');
      if (lastNl >= 0) { // 완성된 줄까지만 세고, 나머지는 다음에
        for (const s of parse(text.slice(0, lastNl))) {
          if (s.type !== 'PLANNER_RESPONSE') continue;
          const u = c.usage; u.calls++; u.input += s.input_tokens || 0; u.cached += s.cache_read_tokens || 0; u.output += s.output_tokens || 0;
        }
        c.offset += Buffer.byteLength(text.slice(0, lastNl + 1), 'utf8');
      }
    } finally { closeSync(fd); }
  } catch {}
  usageCache.delete(tf); usageCache.set(tf, c);
  while (usageCache.size > 20) usageCache.delete(usageCache.keys().next().value);
  return c.usage;
}

// 최근 대화 목록 (5초 캐시)
let convCache = { at: 0, items: [] };
function recentConversations() {
  if (Date.now() - convCache.at < 5000) return convCache.items;
  const list = [];
  for (const b of brainDirs()) {
    let names = [];
    try { names = readdirSync(b); } catch { continue; }
    for (const n of names) {
      if (!ID_RE.test(n)) continue;
      const t = transcriptOf(join(b, n));
      if (!t) continue;
      try { list.push({ id: n, product: b.split(/[\\/]/).slice(-2)[0], mtime: statSync(t).mtimeMs, tf: t }); } catch {}
    }
  }
  list.sort((a, b) => b.mtime - a.mtime);
  const top = list.slice(0, 12).map((c) => {
    let title = '';
    try { const first = readFirstLine(c.tf); title = first && first.type === 'USER_INPUT' ? clip(stripUser(first.content).split('\n')[0], 60) : '(워커/서브에이전트)'; } catch {}
    return { id: c.id, product: c.product, mtime: c.mtime, title };
  });
  convCache = { at: Date.now(), items: top };
  return top;
}

// 별도 프로세스로 node 스크립트 실행 (오래 걸리는 git 작업이 패널 전체를 멈추지 않게)
function runNode(script, args, timeout = 90000) {
  return new Promise((resolveP) => {
    execFile(process.execPath, ['--max-old-space-size=256', join(PLUGIN_ROOT, script), ...args], { timeout, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolveP({ ok: !err, out: stdout || '', err: (stderr || (err && err.message) || '').slice(0, 500) });
    });
  });
}

// ---------- 페이지 ----------
// 페이지에 토큰을 넣는다. preload.js 보다 먼저 주소에 ?token= 을 붙여, SDK 의 secureFetch·sendMessage 도 토큰을 보내게 한다.
app.page('/', () => readFileSync(join(here, 'ui.html'), 'utf8').replace('<script src="/preload.js"></script>',
  `<script>(function(){var t=${JSON.stringify(UI_TOKEN)};window.__IMPLANT_TOKEN=t;var p=new URLSearchParams(location.search);if(!p.get('token')){p.set('token',t);history.replaceState(null,'',location.pathname+'?'+p.toString()+location.hash);}})();</script>\n<script src="/preload.js"></script>`));

// ---------- API ----------
app.api('/api/conversations', () => ({ items: recentConversations() }), 'GET');

app.api('/api/state', (q) => {
  let conv = q.conversationId;
  if (!conv || !convDir(conv)) {
    const r = recentConversations()[0];
    conv = r ? r.id : null;
  }
  const dir = convDir(conv);
  if (!dir) return { found: false };
  const tf = transcriptOf(dir);
  if (!tf) return { found: false };
  let st;
  try { st = statSync(tf); } catch { return { found: false }; } // 읽는 사이 지워졌거나 잠김
  const media = join(dir, '.system_generated', 'logs', 'media');
  // 이미지가 덮어써지거나 백그라운드 로그만 늘어난 것도 알아채도록 최신 파일 시각을 함께 넣는다
  const newestIn = (d) => { try { return Math.max(0, ...readdirSync(d).slice(-200).map((n) => fileStamp(join(d, n)))); } catch { return 0; } };
  const etag = [conv, st.size, st.mtimeMs, newestIn(media), newestIn(join(dir, '.system_generated', 'tasks')), fileStamp(join(STATE_DIR, conv + '.json')), fileStamp(LIVE_RULES), fileStamp(join(dir, 'task.md')),
    fileStamp(join(dir, 'implementation_plan.md')), fileStamp(media), fileStamp(dir), fileStamp(join(dir, '.system_generated', 'tasks')), fileStamp(join(DATA_DIR, 'config.json'))].join(':');
  if (q.etag && q.etag === etag) return { found: true, unchanged: true, etag };

  const steps = parse(readTail(tf, 768 * 1024));
  const view = steps.slice(-80).map(simplify);
  const last = steps[steps.length - 1];
  const firstLine = readFirstLine(tf);
  const hook = loadHookState(conv);

  // 이번 턴 통계
  let ui = -1;
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].type === 'USER_INPUT') { ui = i; break; }
  const turn = ui >= 0 ? steps.slice(ui + 1) : steps;
  const planners = turn.filter((s) => s.type === 'PLANNER_RESPONSE');
  const tools = planners.flatMap((s) => (s.tool_calls || []).map((t) => t.name));
  let silent = 0;
  for (let i = planners.length - 1; i >= 0; i--) { if (String(planners[i].content || '').trim()) break; if ((planners[i].tool_calls || []).length) silent++; }
  const EDIT = /^(write_file|edit_file|write_to_file|replace_file_content|multi_replace_file_content|sed_file|notebook_edit)$/;
  const edited = [...new Set(planners.flatMap((s) => (s.tool_calls || []).filter((t) => EDIT.test(t.name)).map((t) => (t.args && (t.args.TargetFile || t.args.Path || t.args.AbsolutePath || t.args.File)) || '')).filter(Boolean))];
  // 컨텍스트: 압축(체크포인트) 이후의 마지막 값만
  let ctx = null;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.type === 'CHECKPOINT') break;
    if (s.type === 'PLANNER_RESPONSE' && (s.input_tokens || s.cache_read_tokens)) { ctx = (s.input_tokens || 0) + (s.cache_read_tokens || 0); break; }
  }
  let preset = 'standard';
  try { preset = JSON.parse(readFileSync(join(DATA_DIR, 'config.json'), 'utf8')).preset || 'standard'; } catch {}

  return {
    found: true, etag, conversationId: conv,
    isMain: firstLine ? firstLine.type === 'USER_INPUT' : null,
    lastStepAt: last && last.created_at, lastStepType: last && last.type, lastStepStatus: last && last.status,
    now: Date.now(),
    turn: { userText: ui >= 0 ? clip(stripUser(steps[ui].content), 300) : '', modelCalls: planners.length, toolCalls: tools.length, silentStreak: silent, edited },
    contextTokens: ctx,
    usage: usageOf(tf),
    preset,
    hook: { model: hook.model, turnOpen: hook.turnOpen, lastInvokeAt: hook.lastInvokeAt, lastStopAt: hook.lastStopAt, stopAsked: hook.stopAsked || 0, events: (hook.events || []).slice(-12) },
    steps: view,
    images: listImages(dir),
    plan: readPlan(dir),
    tasks: readTasks(dir),
    liveRules: { exists: existsSync(LIVE_RULES), mtime: fileStamp(LIVE_RULES) },
  };
}, 'GET');

app.api('/api/img', (q) => {
  const dir = convDir(q.conversationId);
  const name = String(q.name || '');
  if (!dir || !IMG_RE.test(name) || /[\\/]|\.\./.test(name)) return new Response('bad request', { status: 400 });
  const base = q.src === 'artifact' ? dir : join(dir, '.system_generated', 'logs', 'media');
  const f = join(base, name);
  try { if (!statSync(f).isFile()) return new Response('not found', { status: 404 }); } catch { return new Response('not found', { status: 404 }); }
  // 주소에 파일 시각(v=)이 붙으므로 덮어쓰면 새 주소가 되어 오래 캐시해도 된다
  return new Response(readFileSync(f), { contentType: MIME[extname(name).toLowerCase()] || 'application/octet-stream', headers: { 'Cache-Control': q.v ? 'max-age=3600' : 'no-cache' } });
}, 'GET');

app.api('/api/live-rules', () => {
  let text = '';
  try { text = readFileSync(LIVE_RULES, 'utf8'); } catch { text = LIVE_RULES_TEMPLATE; }
  return { path: LIVE_RULES, text, mtime: fileStamp(LIVE_RULES) };
}, 'GET');

app.api('/api/live-rules', (body) => {
  const text = String((body && body.text) || '');
  // 훅은 주석을 뺀 앞 2000자만 넣는다(liveRulesMaxChars). 그보다 길면 잘리지 않게 저장 전에 알린다.
  if (text.replace(/<!--[\s\S]*?-->/g, '').trim().length > 2000) return jsonError('실시간 규칙은 주석을 빼고 2000자까지만 적용됩니다. 줄여 주세요.', 413);
  if (text.length > 20000) return jsonError('too long', 413);
  try { atomicWrite(LIVE_RULES, text); } catch (e) { return jsonError('저장 실패: ' + e.code, 500); }
  return { ok: true, mtime: fileStamp(LIVE_RULES) };
}, 'POST');

// 모드 프리셋 (Claude Code 의 출력 스타일처럼): 훅 설정 몇 가지를 한 번에 바꾼다
const PRESETS = {
  standard: { preset: 'standard', remindMode: { gemini: 'always', claude: 'smart', default: 'smart' }, silentWarnAfter: 2, stopGate: true, stopRequireVerification: true, planNudgeAfter: 4 },
  concise: { preset: 'concise', remindMode: { gemini: 'smart', claude: 'smart', default: 'smart' }, silentWarnAfter: 3, stopGate: true, stopRequireVerification: false, planNudgeAfter: 99 },
  strict: { preset: 'strict', remindMode: { gemini: 'always', claude: 'always', default: 'always' }, silentWarnAfter: 1, stopGate: true, stopRequireVerification: true, planNudgeAfter: 3 },
};
app.api('/api/preset', (body) => {
  const p = PRESETS[body && body.name];
  if (!p) return jsonError('unknown preset');
  const cf = join(DATA_DIR, 'config.json');
  let cfg = {};
  if (existsSync(cf)) {
    // 설정 파일이 깨져 있으면 덮어쓰지 않는다 (사용자가 넣은 verifyCommand 같은 값이 날아가지 않게)
    try { cfg = JSON.parse(readFileSync(cf, 'utf8').replace(/^﻿/, '')); } catch { return jsonError('설정 파일(config.json)을 읽을 수 없어 바꾸지 않았습니다. 파일을 확인하세요.', 500); }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return jsonError('설정 파일 형식이 이상해 바꾸지 않았습니다.', 500);
  }
  try { atomicWrite(cf, JSON.stringify({ ...cfg, ...p }, null, 1)); } catch (e) { return jsonError('저장 실패: ' + e.code, 500); }
  return { ok: true, preset: p.preset };
}, 'POST');

// 변경 보기: 이 대화의 작업 폴더(훅이 기록한 것)만, 읽기 전용 git 명령만, 외부 프로그램 실행은 끈 채로.
function git(cwd, args, max = 400 * 1024) {
  return new Promise((resolveP) => {
    execFile('git', ['-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', '-C', cwd, ...args],
      { timeout: 8000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
        if (err && !stdout) return resolveP({ ok: false, out: String(err.message || err).slice(0, 300) });
        resolveP({ ok: true, out: stdout.length > max ? stdout.slice(0, max) + '\n… (너무 길어 잘림)' : stdout });
      });
  });
}
const isLocalAbs = (d) => /^[a-z]:[\\/]/i.test(String(d || '')); // \\server\share (UNC) 와 상대 경로는 거부
let diffBusy = false;
app.api('/api/diff', async (q) => {
  const conv = q.conversationId;
  if (!ID_RE.test(String(conv || ''))) return { at: Date.now(), repos: [] };
  if (diffBusy) return { busy: true };
  diffBusy = true;
  try {
    const dirs = [...new Set((loadHookState(conv).workspacePaths || []).filter(isLocalAbs))]
      .filter((d) => { try { return statSync(d).isDirectory(); } catch { return false; } }).slice(0, 4);
    const repos = await Promise.all(dirs.map(async (d) => {
      const top = await git(d, ['rev-parse', '--show-toplevel']);
      if (!top.ok) return { dir: d, git: false };
      const [status, stat, diff] = await Promise.all([
        git(d, ['status', '--porcelain=v1', '-unormal']),
        git(d, ['diff', 'HEAD', '--no-ext-diff', '--no-textconv', '--stat']),
        git(d, ['diff', 'HEAD', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3']),
      ]);
      return { dir: d, git: true, root: top.out.trim(), status: status.out, stat: stat.out, diff: diff.out };
    }));
    return { at: Date.now(), repos };
  } finally { diffBusy = false; }
}, 'GET');

// 체크포인트 — 무거운 git 작업은 cli/rewind.mjs 를 별도 프로세스로 돌린다
app.api('/api/checkpoints', async (q) => {
  if (!ID_RE.test(String(q.conversationId || ''))) return { items: [] };
  const r = await runNode('cli/rewind.mjs', ['list', q.conversationId, '--json'], 15000);
  try { return JSON.parse(r.out); } catch { return { items: [], error: r.err }; }
}, 'GET');
app.api('/api/checkpoint-diff', async (q) => {
  if (!ID_RE.test(String(q.conversationId || ''))) return { error: 'bad id' };
  const id = String(q.id || '');
  if (!CP_ID_RE.test(id) || id.startsWith('-')) return { error: '체크포인트 번호가 없습니다' };
  const r = await runNode('cli/rewind.mjs', ['diff', q.conversationId, id, '--json']);
  try { return JSON.parse(r.out); } catch { return { error: r.err || '실패' }; }
}, 'GET');
let rewindBusy = false;
app.api('/api/rewind', async (body) => {
  const conv = String((body && body.conversationId) || '');
  if (!ID_RE.test(conv)) return jsonError('bad id');
  const id = String((body && body.id) || '');
  if (!CP_ID_RE.test(id) || id.startsWith('-')) return jsonError('체크포인트 번호가 없습니다'); // 빈 값이면 마지막 것으로 덮어쓰는 사고 방지
  if (rewindBusy) return jsonError('다른 되돌리기가 진행 중입니다', 409);
  rewindBusy = true;
  try {
    const r = await runNode('cli/rewind.mjs', ['restore', conv, id, '--json']);
    let j; try { j = JSON.parse(r.out); } catch { return jsonError(r.err || '실패', 500); }
    return j.ok ? j : jsonError(j.error || '실패', 500);
  } finally { rewindBusy = false; }
}, 'POST');

// 일시정지: 다음 모델 호출 직전에 PreInvocation 훅이 이 파일을 보고 멈춘다 (1회용, 10분 만료).
const PAUSE_DIR = join(DATA_DIR, 'pause');
app.api('/api/pause', (body) => {
  const conv = String((body && body.conversationId) || '');
  if (!convDir(conv)) return jsonError('unknown conversation');
  try { atomicWrite(join(PAUSE_DIR, conv), new Date().toISOString()); } catch (e) { return jsonError('실패: ' + e.code, 500); }
  return { ok: true };
}, 'POST');

app.run();
