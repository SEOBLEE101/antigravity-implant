// agy CLI 상태줄: 지금 무엇을 하는지 한 줄로.
// ~/.gemini/antigravity-cli/settings.json 의 "statusLine" 에 연결한다 (README 참고).
// 어떤 오류가 나도 짧은 기본 줄을 내고 종료 코드 0 으로 끝낸다.
// stdin 1초 마감·EPIPE 무시는 wassim-azi/agy-powerline (MIT) src/runtime/statusline.js 를 참고했다:
// agy 가 stdin 을 닫지 않는 경우(#698) 막는 읽기가 매달리면 agy 가 상태줄을 꺼 버린다.
import { readFileSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

process.stdout.on('error', () => {}); // EPIPE 등 무시
const CTX_CEIL = 125000; // 자동 압축 근처로 보는 값 (색 기준 70% / 90%)

function readStdin(deadlineMs) {
  return new Promise((resolve) => {
    let buf = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(buf); } };
    const timer = setTimeout(finish, deadlineMs);
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { buf += c; });
      process.stdin.on('end', () => { clearTimeout(timer); finish(); });
      process.stdin.on('error', () => { clearTimeout(timer); finish(); });
    } catch { clearTimeout(timer); finish(); }
  });
}

function tail(file, bytes) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    const n = readSync(fd, buf, 0, buf.length, start);
    let t = buf.subarray(0, n).toString('utf8');
    if (start > 0) { const i = t.indexOf('\n'); t = i < 0 ? '' : t.slice(i + 1); } // 잘린 첫 줄은 버림
    return t.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } finally { closeSync(fd); }
}

const pick = (o, ...paths) => {
  for (const p of paths) {
    let v = o;
    for (const k of p.split('.')) v = v == null ? undefined : v[k];
    if (v != null && v !== '') return v;
  }
  return undefined;
};

function build(raw) {
  const s = raw.replace(/^﻿/, '').trim() ? JSON.parse(raw.replace(/^﻿/, '')) : {};
  const model = pick(s, 'model.display_name', 'model.name', 'model') || '?';
  const state = pick(s, 'agent_state', 'state') || '';
  const conv = pick(s, 'conversation_id', 'conversationId');
  const tp = pick(s, 'transcript_path', 'transcriptPath');
  let ctxPct = pick(s, 'context_window.used_percentage', 'context_window.usedPercentage');
  const pending = pick(s, 'pending_input_count');

  let lastTool = '', age = '', silent = 0, ctxTok = 0, scanned = false;
  let steps = [];
  if (tp) { try { steps = tail(tp, 128 * 1024); } catch {} }
  if (steps.length) {
    const last = steps[steps.length - 1];
    if (last && last.created_at) {
      const sec = Math.max(0, Math.round((Date.now() - Date.parse(last.created_at)) / 1000));
      age = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
    }
    let textSeen = false;
    for (let i = steps.length - 1; i >= 0; i--) {
      const st = steps[i];
      if (st.type === 'USER_INPUT' || st.type === 'CHECKPOINT') break; // 지난 턴·압축 전 값은 쓰지 않는다
      if (st.type !== 'PLANNER_RESPONSE') continue;
      scanned = true;
      if (!ctxTok && (st.input_tokens || st.cache_read_tokens)) ctxTok = (st.input_tokens || 0) + (st.cache_read_tokens || 0);
      if (!lastTool && (st.tool_calls || []).length) lastTool = st.tool_calls[0].name;
      if (!textSeen) { if (String(st.content || '').trim()) textSeen = true; else if ((st.tool_calls || []).length) silent++; }
      if (textSeen && lastTool && ctxTok) break;
    }
  }
  if (!scanned && conv) { // 기록을 못 읽었을 때만 훅 상태로 대신한다
    try { silent = JSON.parse(readFileSync(join(homedir(), '.gemini', 'antigravity-implant', 'state', conv + '.json'), 'utf8')).silentStreak || 0; } catch {}
  }
  if (ctxPct == null && ctxTok) ctxPct = (ctxTok / CTX_CEIL) * 100;

  const parts = [`[${String(model).replace(/^Gemini\s*/i, '')}]`];
  if (state) parts.push(state + (lastTool ? `(${lastTool}${age ? ' · ' + age : ''})` : age ? ` · ${age}` : ''));
  if (silent >= 2) parts.push(`\x1b[33m말없이 ${silent}회\x1b[0m`);
  if (ctxPct != null) {
    const p = Math.round(Number(ctxPct));
    const label = ctxTok ? `ctx ${Math.round(ctxTok / 1000)}k` : `ctx ${p}%`;
    parts.push(p >= 90 ? `\x1b[31m${label}\x1b[0m` : p >= 70 ? `\x1b[33m${label}\x1b[0m` : label);
  }
  if (pending) parts.push(`대기 메시지 ${pending}`);
  return parts.join(' | ');
}

let line = '[agy]';
try { line = build(await readStdin(1000)); } catch {}
// stdin 이 열린 채 남아 있어도 끝나도록, 다 쓴 뒤 직접 종료한다.
try { process.stdout.write(line + '\n', () => process.exit(0)); } catch { process.exit(0); }
setTimeout(() => process.exit(0), 300);
