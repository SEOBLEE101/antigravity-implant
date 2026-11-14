// 상태줄 시험: 가짜 대화 기록을 만들고 node 로 stdin 을 정확히 UTF-8 로 넣는다 (PowerShell 파이프는 한글을 깨뜨린다).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'antigravity-implant', 'cli', 'statusline.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'implant-sl-'));
let fails = 0;
const check = (n, c, d) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '\n      ' + d}`); if (!c) fails++; };
const run = (input) => { const r = spawnSync(process.execPath, [script], { input, encoding: 'utf8', timeout: 10000 }); return { code: r.status, out: (r.stdout || '').trim() }; };

try {
  const conv = '11111111-2222-3333-4444-555555555555';
  const logs = join(tmp, conv, '.system_generated', 'logs');
  mkdirSync(logs, { recursive: true });
  const now = new Date().toISOString();
  const steps = [
    { type: 'PLANNER_RESPONSE', content: '앞 턴', tool_calls: [{ name: 'old_tool' }], input_tokens: 99000, created_at: now },
    { type: 'USER_INPUT', content: '<USER_REQUEST>새 요청</USER_REQUEST>', created_at: now },
    { type: 'PLANNER_RESPONSE', content: '', tool_calls: [{ name: 'read_file' }], input_tokens: 20000, cache_read_tokens: 8000, created_at: now },
    { type: 'GENERIC', content: 'ok', created_at: now },
    { type: 'PLANNER_RESPONSE', content: '', tool_calls: [{ name: 'run_command' }], input_tokens: 21000, cache_read_tokens: 8000, created_at: now },
  ];
  const tp = join(logs, 'transcript_full.jsonl');
  writeFileSync(tp, steps.map((s, i) => JSON.stringify({ step_index: i, ...s })).join('\n') + '\n');

  const full = run(JSON.stringify({ model: { display_name: 'Gemini 3.8 Flash' }, agent_state: 'tool_use', conversation_id: conv, transcript_path: tp, pending_input_count: 1 }));
  check('기록이 있으면 모델·상태·마지막 도구·말없는 횟수·컨텍스트·대기 메시지', full.code === 0 && /\[3\.8 Flash\]/.test(full.out) && /tool_use\(run_command/.test(full.out) && /말없이 2회/.test(full.out) && /ctx 29k/.test(full.out) && /대기 메시지 1/.test(full.out), full.out);
  check('지난 턴 값(old_tool, 99k)을 쓰지 않음', !/old_tool|99k/.test(full.out), full.out);
  const bom = run('﻿' + JSON.stringify({ model: 'Gemini 4 Carbon (High)', agent_state: 'working' }));
  check('BOM 붙은 입력', bom.code === 0 && /\[4 Carbon \(High\)\] \| working/.test(bom.out), bom.out);
  const empty = run('');
  check('빈 입력이어도 한 줄', empty.code === 0 && empty.out === '[?]', empty.out);
  const garbage = run('not json');
  check('깨진 입력이어도 한 줄', garbage.code === 0 && garbage.out === '[agy]', garbage.out);
} finally { rmSync(tmp, { recursive: true, force: true }); }
console.log(fails ? `\n${fails}개 실패` : '\n전부 통과');
process.exitCode = fails ? 1 : 0;
