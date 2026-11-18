// antigravity-implant 훅 공통 도구.
// 원칙: 어떤 오류가 나도 훅은 에이전트를 막지 않는다. 출력은 항상 ASCII 로 이스케이프한 JSON 한 줄.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, openSync, readSync, fstatSync, closeSync, existsSync, statSync, renameSync, rmSync, readdirSync, rmdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = join(homedir(), '.gemini', 'antigravity-implant');
// 예전 이름(agy-communicator)으로 쓰던 데이터 폴더가 있으면 옮긴다 (설정·체크포인트·폴더 허락 기억 유지).
// 새 폴더가 이미 생겼어도(패널 등이 먼저 만든 경우) 새 폴더에 없는 항목만 하나씩 옮긴다.
export function migrateOldData() {
  const old = join(homedir(), '.gemini', 'agy-communicator');
  if (!existsSync(old)) return;
  try {
    if (!existsSync(DATA_DIR)) { renameSync(old, DATA_DIR); return; }
    for (const n of readdirSync(old)) {
      const dst = join(DATA_DIR, n);
      if (!existsSync(dst)) { try { renameSync(join(old, n), dst); } catch {} }
    }
    try { rmdirSync(old); } catch {} // 비었으면 지움 (남은 게 있으면 그대로)
  } catch {}
}
migrateOldData();

// 도구 인자에서 대상 파일 경로를 꺼낸다. 이름이 여러 가지(Path, AbsolutePath, TargetFile, File, path, file_path)이고,
// 상대 경로면 작업 폴더(base) 기준 절대 경로로 바꾼다. 비교용으로 쓸 땐 normKey 로 소문자·역슬래시로 맞춘다.
export function argPath(args, base) {
  const a = args || {};
  const p = a.Path || a.AbsolutePath || a.TargetFile || a.File || a.path || a.file_path || a.filePath || '';
  if (!p || typeof p !== 'string') return '';
  if (isAbsolute(p) || /^[a-z]:[\\/]/i.test(p)) return resolve(p);
  return base ? resolve(base, p) : p;
}
export const normKey = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
export const STATE_DIR = join(DATA_DIR, 'state');
export const ID_RE = /^[0-9a-zA-Z-]{8,64}$/;

// 원자적 저장: 고유한 임시 파일에 쓰고 바꿔 끼운다. Windows 에서 다른 프로세스·백신이 잡고 있으면 잠깐 기다렸다 다시.
export function atomicWrite(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  for (let i = 0; ; i++) {
    try { renameSync(tmp, file); return; } catch (e) {
      if (i >= 5 || !/EPERM|EACCES|EBUSY/.test(String(e.code))) { try { rmSync(tmp, { force: true }); } catch {} throw e; }
      const until = Date.now() + 30 * (i + 1); while (Date.now() < until) { /* 짧게 기다림 */ }
    }
  }
}

// ---------- 입출력 ----------
export function readStdin() {
  try {
    const raw = readFileSync(0, 'utf8').replace(/^﻿/, ''); // 앞에 BOM 이 붙어 와도 읽는다
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function asciiJson(obj) {
  return JSON.stringify(obj).replace(/[^\x00-\x7e]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

export function emit(obj) {
  try { process.stdout.write(asciiJson(obj || {}) + '\n'); } catch {}
}

// 훅 본문을 감싼다: 예외가 나면 기록만 하고 fallback 을 내보낸다.
export function runHook(name, fn, fallback = {}) {
  let out = fallback;
  try {
    if (existsSync(join(DATA_DIR, 'off'))) { emit({}); return; } // 전체 끄기 스위치
    const input = readStdin();
    const r = fn(input);
    if (r && typeof r === 'object') out = r;
  } catch (e) {
    logError(name, e);
    out = fallback;
  }
  emit(out);
  process.exitCode = 0;
}

export function logError(name, e) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(join(DATA_DIR, 'errors.log'), `${new Date().toISOString()} ${name} ${e && e.stack ? e.stack : e}\n`, 'utf8');
  } catch {}
}

// ---------- 설정 ----------
const DEFAULT_CONFIG = {
  enabled: true,
  // 진행률 줄. 사용자의 전역 GEMINI.md 규칙과 같은 형식.
  progressRegex: '\\d{1,3}\\s*%\\s*(순조롭게 진행중입니다|문제를 해결중입니다)',
  progressHint: '`NN% 순조롭게 진행중입니다` (막혔으면 `NN% 문제를 해결중입니다`)',
  // 매 모델 호출 알림: "always" | "smart" | "off". smart = 새 메시지이거나 조용한 호출이 이어질 때만.
  remindMode: { gemini: 'always', claude: 'smart', default: 'smart' },
  silentWarnAfter: 2,
  stopGate: true,
  stopRequireVerification: true,
  // 파일을 고친 뒤 마무리 점검이 권할 검증 명령 (예: "npm test"). 작업 폴더의 .agents/verify-command 첫 줄이 있으면 그게 우선.
  verifyCommand: '',
  syntaxCheck: true, // 고친 .js/.mjs/.cjs/.json/.py 파일 문법 검사 → 오류면 다음 호출에 알림
  dangerGuard: true, // 위험한 터미널 명령(드라이브 통째 삭제, 강제 푸시 등) 차단
  liveRulesFile: join(homedir(), '.gemini', 'config', 'live_rules.md'),
  liveRulesMaxChars: 2000,
  // 작업 도중 이 파일들이 바뀌면 새 내용을 한 번 주입한다 (Antigravity 는 턴이 끝나야 규칙을 다시 읽는다)
  watchRuleFiles: [join(homedir(), '.gemini', 'GEMINI.md'), join(homedir(), '.gemini', 'config', 'GEMINI.md'), join(homedir(), '.gemini', 'config', 'AGENTS.md')],
  watchWorkspaceRules: ['GEMINI.md', 'AGENTS.md', '.agents/GEMINI.md', '.agents/AGENTS.md'],
  ruleChangeMaxChars: 4000,
  pauseMaxAgeMs: 10 * 60 * 1000,
  repeatReadAfter: 3,   // 이번 턴에 같은 파일을 이만큼 읽으면 알림
  repeatCommandAfter: 3, // 같은 명령을 이만큼 돌리면 알림
  errorStreakAfter: 3,   // 도구 오류가 이만큼 이어지면 알림
  sameFailureAfter: 2,   // 같은 종류의 오류(경로·숫자 지운 서명)가 이만큼 나면 알림
  // 컨텍스트 경고 (기준은 wojciehm/antigravity-context-guard 의 아이디어: 125k 근처에서 자동 압축된다고 보고 68%/84%)
  contextWarnTokens: 85000,
  contextDangerTokens: 105000,
  contextRewarnStep: 10000,
  earlyStopGuard: true,
  planNudgeAfter: 4, // 이번 턴 도구 호출이 이만큼인데 task.md 가 없으면 한 번 알림
  checkpoints: true, // 요청마다 작업 폴더(git 저장소) 체크포인트
};

export function loadConfig() {
  let user = {};
  try { user = JSON.parse(readFileSync(join(DATA_DIR, 'config.json'), 'utf8').replace(/^﻿/, '')); } catch {}
  if (!user || typeof user !== 'object') user = {};
  return { ...DEFAULT_CONFIG, ...user, remindMode: { ...DEFAULT_CONFIG.remindMode, ...(user.remindMode || {}) } };
}

// ---------- 대화별 상태 ----------
export function loadState(conv) {
  if (!conv || !ID_RE.test(conv)) return {};
  try { return JSON.parse(readFileSync(join(STATE_DIR, conv + '.json'), 'utf8')); } catch { return {}; }
}

export function saveState(conv, state) {
  if (!conv || !ID_RE.test(conv)) return;
  try {
    atomicWrite(join(STATE_DIR, conv + '.json'), JSON.stringify(state));
  } catch (e) { logError('saveState', e); }
}

// 사이드카가 읽는 훅 활동 기록 (대화별 최근 30개).
export function pushEvent(state, ev) {
  const list = Array.isArray(state.events) ? state.events : [];
  list.push({ at: new Date().toISOString(), ...ev });
  state.events = list.slice(-30);
}

// ---------- transcript ----------
function readTail(file, bytes) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    const n = readSync(fd, buf, 0, buf.length, start);
    let text = buf.subarray(0, n).toString('utf8');
    if (start > 0) { const i = text.indexOf('\n'); text = i < 0 ? '' : text.slice(i + 1); } // 잘린 첫 줄 버리기
    return { text, truncated: start > 0 };
  } finally { closeSync(fd); }
}

// 첫 줄 전체 (줄바꿈이 나올 때까지 최대 4MB)
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
      chunks.push(buf.subarray(0, n));
      pos += n;
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { closeSync(fd); }
}

function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

// 훅이 받은 transcriptPath 는 transcript_full.jsonl. 없으면 transcript.jsonl 로.
export function transcriptFile(input) {
  const p = input && input.transcriptPath;
  if (p && existsSync(p)) return p;
  if (p) {
    const alt = join(dirname(p), 'transcript.jsonl');
    if (existsSync(alt)) return alt;
  }
  return null;
}

// 메인 대화인가? 사용자가 직접 연 대화는 첫 단계가 USER_INPUT(USER_EXPLICIT) 이다.
// swarm 워커·서브에이전트는 "[Message] ... sender=<부모>" SYSTEM_MESSAGE 로 시작하고 USER_INPUT 이 없다.
export function isMainConversation(input, state) {
  if (typeof state.isMain === 'boolean') return state.isMain;
  const f = transcriptFile(input);
  if (!f) return null; // 아직 모름
  const first = parseLines(readFirstLine(f) + '\n')[0];
  if (!first) return null;
  const main = first.type === 'USER_INPUT' && (first.source === 'USER_EXPLICIT' || !first.source);
  state.isMain = main;
  return main;
}

// 이번 사용자 턴의 단계들 (마지막 USER_INPUT 이후).
export function turnSteps(input) {
  const f = transcriptFile(input);
  if (!f) return { steps: [], userIdx: null, userText: '' };
  // 보통은 끝 512KB 로 충분하다. 이번 턴이 그보다 길어 사용자 메시지가 안 보이면 4MB 까지 넓혀 본다.
  let all = [];
  let ui = -1;
  for (const size of [512 * 1024, 4 * 1024 * 1024]) {
    const r = readTail(f, size);
    all = parseLines(r.text);
    ui = -1;
    for (let i = all.length - 1; i >= 0; i--) if (all[i].type === 'USER_INPUT') { ui = i; break; }
    if (ui >= 0 || !r.truncated) break;
  }
  const user = ui >= 0 ? all[ui] : null;
  return {
    all,
    steps: ui >= 0 ? all.slice(ui + 1) : all,
    before: ui >= 0 ? all.slice(0, ui) : [],
    userIdx: user ? user.step_index : null,
    userText: user ? stripUserWrapper(String(user.content || '')) : '',
  };
}

export function stripUserWrapper(s) {
  const m = s.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  return (m ? m[1] : s).trim();
}

export const isPlanner = (s) => s && s.type === 'PLANNER_RESPONSE';
export const visibleText = (s) => String((s && s.content) || '').trim();
export const toolNames = (s) => ((s && s.tool_calls) || []).map((t) => t.name);

// 끝에서부터 "말없이 도구만 부른" 모델 응답이 몇 번 이어졌나.
export function silentStreak(steps) {
  let n = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (!isPlanner(s)) continue;
    if (visibleText(s)) break;
    if (toolNames(s).length) n++;
  }
  return n;
}

export function lastPlanner(steps) {
  for (let i = steps.length - 1; i >= 0; i--) if (isPlanner(steps[i])) return steps[i];
  return null;
}

// 대화 기록(transcript)에는 모델이 받은 도구 이름과 다른 짧은 이름이 남는다 (write_file, edit_file, read_file …).
// 둘 다 넣어 둔다.
export const EDIT_TOOLS = new Set(['write_file', 'edit_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content', 'sed_file', 'notebook_edit']);
// 화면을 "찍거나" 이미지를 "만든" 도구만 (클릭·스크롤 같은 조작마다 증거 알림을 내지 않게)
const VISUAL_NAMES = new Set(['capture_browser_screenshot', 'browser_subagent', 'generate_image']);
export const VISUAL_TOOLS = { has: (n) => VISUAL_NAMES.has(n) || /screenshot/i.test(String(n || '')) };

// 도구 호출의 대상 경로·명령 (반복 감지용)
export function toolTarget(call) {
  const a = (call && call.args) || {};
  const p = a.Path || a.AbsolutePath || a.TargetFile || a.File || a.path || a.Url || a.url;
  // 같은 파일이라도 다른 구간을 나눠 읽는 건 반복이 아니다 → 읽기 범위까지 포함
  const range = [a.StartLine, a.EndLine, a.ByteOffset].some((v) => v != null) ? `#${a.StartLine ?? ''}-${a.EndLine ?? ''}@${a.ByteOffset ?? ''}` : '';
  if (p) return String(p).replace(/\\/g, '/').toLowerCase() + range;
  if (a.CommandLine) return 'cmd:' + String(a.CommandLine).trim().replace(/\s+/g, ' ').toLowerCase();
  return '';
}

// 오류 서명: 경로·숫자·따옴표 안 내용을 지워 "같은 종류의 실패"를 묶는다.
// (아이디어 출처: ibsorn/ultragravity parse_tool_result.py, MIT)
export function failureSignature(text) {
  let s = String(text || '').replace(/^(Created At|Completed At):.*$/gm, '').trim();
  s = s.split('\n').find((l) => /error|fail|denied|not found|exception|cannot|오류|실패/i.test(l)) || s.split('\n')[0] || '';
  return s
    .replace(/(['"`]).*?\1/g, '<str>') // 따옴표 안 (공백 든 경로 포함) 먼저
    .replace(/[A-Za-z]:[\\/][^'"\n]*?(?=$|\s{2,}|[,;:)]\s|\s(at|line|in|on|is|was|not)\b)/g, '<path>')
    .replace(/(?:\.{0,2}[\\/])?(?:[^\s'"\\/<>]+[\\/])+[^\s'"\\/<>]+/g, '<path>')
    .replace(/0x[0-9a-f]+|\d+/gi, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

export function fileMtime(p) {
  try { return statSync(p).mtimeMs; } catch { return 0; }
}
