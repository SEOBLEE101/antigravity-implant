// 모든 시험을 "가짜 사용자 폴더"에서 돌린다 — 실제 ~/.gemini 설정·상태·live_rules.md 를 건드리지 않는다.
// 시험마다 메모리 상한(node 힙 512MB)과 시간 제한(120초)을 건다.
// 실행: node tests/run-all.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TESTS = ['run-tests', 'features-test', 'checkpoint-test', 'folder-grants-test', 'cockpit-rewind-test', 'statusline-test', 'mesh-test'];
const fakeHome = mkdtempSync(join(tmpdir(), 'implant-home-'));
mkdirSync(join(fakeHome, '.gemini', 'config'), { recursive: true });
// 패널 시험용: 실제 앱이 깔아 둔 sidecar_sdk 위치만 알려 준다 (읽기만 함)
const sdk = [join(homedir(), '.gemini', 'config', 'node_modules', 'sidecar_sdk'), join(homedir(), '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk')].find((d) => existsSync(join(d, 'index.mjs')));
const env = { ...process.env, USERPROFILE: fakeHome, HOME: fakeHome, ...(sdk ? { ANTIGRAVITY_SIDECAR_SDK_DIR: sdk } : {}) };

let total = 0, failed = 0;
const failedTests = [];
try {
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, ['--max-old-space-size=512', join(here, `${t}.mjs`)], { env, encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
    const out = (r.stdout || '') + (r.stderr || '');
    const pass = (out.match(/^PASS/gm) || []).length, fail = (out.match(/^FAIL/gm) || []).length;
    const skipped = /^SKIP/m.test(out);
    total += pass + fail; failed += fail;
    const bad = fail > 0 || (r.status !== 0 && !skipped) || r.error;
    if (bad) failedTests.push(t);
    console.log(`${bad ? '✗' : skipped ? '-' : '✓'} ${t.padEnd(20)} PASS ${pass} / FAIL ${fail}${r.error ? ` (${r.error.code})` : ''}${skipped ? ' (건너뜀: ' + (out.match(/^SKIP\s+(.*)$/m) || [, ''])[1] + ')' : ''}`);
    if (bad) for (const l of out.split('\n').filter((x) => /^FAIL|^\s{6}|Error/.test(x)).slice(0, 12)) console.log('    ' + l.slice(0, 300));
  }
} finally { rmSync(fakeHome, { recursive: true, force: true }); }
console.log(`\n합계: 확인 ${total}개, 실패 ${failed}개${failedTests.length ? ` (실패한 시험: ${failedTests.join(', ')})` : ''}`);
process.exitCode = failedTests.length ? 1 : 0;
