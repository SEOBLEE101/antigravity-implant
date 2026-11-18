// 폴더 단위 허락 시험: 임시 HOME 에서 돌려 실제 설정을 건드리지 않는다.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, rmdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const hooks = join(dirname(fileURLToPath(import.meta.url)), '..', 'antigravity-implant', 'hooks');
const home = mkdtempSync(join(tmpdir(), 'agyc-home-'));
const env = { ...process.env, USERPROFILE: home, HOME: home };
const cfgFile = join(home, '.gemini', 'config', 'config.json');
mkdirSync(dirname(cfgFile), { recursive: true });
// 바깥 폴더는 실제로 있어야 한다(진짜 경로로 판단하므로): 임시 폴더에 만든다
const ext = mkdtempSync(join(tmpdir(), 'agyc-ext-'));
const M = join(ext, 'Music', 'Samples'), W = join(ext, 'Wide');
for (const d of [join(M, 'drums'), join(W, 'deep'), join(ext, 'Denied')]) mkdirSync(d, { recursive: true });
for (const f of [join(M, 'kick.wav'), join(M, 'drums', 'hat.wav'), join(W, 'deep', 'a.txt'), join(ext, 'Denied', 'a.txt')]) writeFileSync(f, 'x');
writeFileSync(cfgFile, JSON.stringify({ plugins: { x: 1 }, userSettings: { autoExecutionPolicy: 'A', globalPermissionGrants: { allow: ['command(git)', `read_file(${W})`] } } }, null, 2) + '\n');
let fails = 0;
const check = (n, c, d) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '\n      ' + d}`); if (!c) fails++; };
const post = (name, path, error = '') => spawnSync(process.execPath, [join(hooks, 'folder_grants.mjs')], { input: JSON.stringify({ toolCall: { name, id: 'x', args: { Path: path } }, workspacePaths: ['C:/work/proj'], error }), encoding: 'utf8', env });
const allow = () => JSON.parse(readFileSync(cfgFile, 'utf8')).userSettings.globalPermissionGrants.allow;
const H = home.replace(/\//g, '\\');

const r1 = post('read_file', join(M, 'kick.wav'));
check('출력은 항상 {} (아무것도 막지 않음)', r1.stdout.trim() === '{}' && r1.status === 0, r1.stdout + r1.stderr);
check('허락된 바깥 파일 → 그 폴더 읽기 규칙 추가 (원래 대소문자)', allow().includes(`read_file(${M}\\)`), JSON.stringify(allow()));
post('read_file', join(M, 'drums', 'hat.wav'));
check('이미 덮인 하위 폴더는 또 넣지 않음', allow().filter((a) => a.startsWith(`read_file(${join(ext, 'Music')}`)).length === 1, JSON.stringify(allow()));
post('read_file', join(W, 'deep', 'a.txt'));
check('기존 넓은 규칙이 덮으면 넣지 않음', !allow().some((a) => a.startsWith(`read_file(${join(W, 'deep')}`)), JSON.stringify(allow()));
post('write_file', join(M, 'new.txt')); // 아직 없는 새 파일: 폴더의 진짜 경로로 판단
check('쓰기는 따로 (write_file 규칙)', allow().includes(`write_file(${M}\\)`), JSON.stringify(allow()));
// 정션(폴더 바로가기)으로 제외 폴더(가짜 홈의 AppData)를 가리키게 해도 넓히지 않음 — 진짜 시스템 폴더는 가리키지 않는다
const jnTarget = join(home, 'AppData', 'Local', 'tgt'); mkdirSync(jnTarget, { recursive: true });
const jn = join(ext, 'jn');
let jnOk = false; try { symlinkSync(jnTarget, jn, 'junction'); jnOk = true; } catch {}
if (jnOk) {
  const before = allow().length; post('write_file', join(jn, 'evil.txt'));
  check('정션으로 AppData 를 가리켜도 넓히지 않음', allow().length === before, JSON.stringify(allow().slice(before)));
}
post('read_file', join(ext, 'Denied', 'a.txt'), 'permission denied');
check('거부(오류)된 건 넣지 않음', !allow().some((a) => a.includes('Denied')), JSON.stringify(allow()));
post('read_file', 'C:\\work\\proj\\src\\a.js');
check('작업 폴더 안은 넣지 않음', !allow().some((a) => a.includes('work')), JSON.stringify(allow()));
for (const [label, p] of [['드라이브 맨 위', 'E:\\a.txt'], ['홈 맨 위', H + '\\notes.txt'], ['.ssh', H + '\\.ssh\\id_rsa'], ['AppData', H + '\\AppData\\Local\\x\\y.txt'], ['Windows', 'C:\\Windows\\System32\\drivers\\etc\\hosts'], ['Program Files', 'C:\\Program Files\\App\\a.dll']]) {
  const before = allow().length; post('read_file', p);
  check(`${label}: 폴더로 넓히지 않음`, allow().length === before, JSON.stringify(allow().slice(before)));
}
// Windows 의 다른 표기로 제외 규칙 비껴가기 → 넓히지 않음
const { folderFor } = await import(pathToFileURL(join(hooks, 'folder_grants.mjs')).href);
for (const [label, p] of [['끝의 점', 'C:\\Windows.\\System32\\x.txt'], ['끝의 공백', 'E:\\Music \\a.txt'], ['짧은 이름', 'C:\\PROGRA~1\\App\\a.dll'], ['데이터 스트림', 'E:\\Music\\a.txt:x\\b'], ['\\\\?\\ 접두사', '\\\\?\\C:\\Windows\\x.txt']]) {
  check(`${label}: 폴더로 넓히지 않음`, folderFor(p) === null, String(folderFor(p)));
}
check('평범한 바깥 폴더는 그대로 됨', folderFor('E:\\Music\\Samples\\a.wav') === 'E:\\Music\\Samples', String(folderFor('E:\\Music\\Samples\\a.wav')));

// 샌드박스 밖 실행(BypassSandbox)을 허락받아 성공한 명령 → 명령에 나온 (실제로 있는) 폴더에 쓰기 허락 (기본 꺼짐)
const implCfg = join(home, '.gemini', 'antigravity-implant', 'config.json');
mkdirSync(dirname(implCfg), { recursive: true });
const postCmd = (args, error = '') => spawnSync(process.execPath, [join(hooks, 'folder_grants.mjs')], { input: JSON.stringify({ toolCall: { name: 'run_command', id: 'x', args }, workspacePaths: ['C:/work/proj'], error }), encoding: 'utf8', env });
const bp = mkdtempSync(join(tmpdir(), 'agyc-bp-'));
const dst = join(bp, 'out'); const tools = join(bp, 'tools'); const plain = join(bp, 'plain');
for (const d of [dst, tools, plain]) mkdirSync(d);
writeFileSync(join(tools, 'tool.exe'), '');
const wr = (d) => `write_file(${d}\\)`;
postCmd({ BypassSandbox: 'true', CommandLine: `git -C "${dst}" commit -qm x` });
check('기본은 꺼짐: 켜기 전에는 명령에서 배우지 않음', !allow().includes(wr(dst)), JSON.stringify(allow().slice(-3)));
writeFileSync(implCfg, JSON.stringify({ folderGrantsFromCommands: true }));
// 앱이 주는 모양 그대로: 값이 JSON 문자열로 한 번 더 감싸져 있음
postCmd({ BypassSandbox: '"true"', CommandLine: JSON.stringify(`git -C "${dst}" commit -qm x`) });
check('우회 실행 성공 → 명령에 나온 폴더 쓰기 규칙 추가', allow().includes(wr(dst)), JSON.stringify(allow().slice(-3)));
postCmd({ CommandLine: JSON.stringify(`Remove-Item "${plain}\\a.txt"`) });
check('샌드박스 안 실행(BypassSandbox 없음)은 넣지 않음', !allow().includes(wr(plain)), JSON.stringify(allow().slice(-3)));
postCmd({ BypassSandbox: true, CommandLine: `Remove-Item "${plain}"` }, 'exit status 1');
check('실패한 우회 실행은 넣지 않음', !allow().includes(wr(plain)), JSON.stringify(allow().slice(-3)));
postCmd({ BypassSandbox: 'true', CommandLine: `"${join(tools, 'tool.exe')}" --version; dir ${join(bp, 'nope')}` });
check('실행한 프로그램 폴더·없는 경로는 넣지 않음', !allow().includes(wr(tools)) && !allow().some((a) => a.includes('nope')), JSON.stringify(allow().slice(-3)));
postCmd({ BypassSandbox: 'true', CommandLine: 'Get-Content C:\\Windows\\System32\\drivers\\etc\\hosts; Get-ChildItem ' + H + '\\.ssh' });
check('시스템·숨김 폴더는 넓히지 않음', !allow().some((a) => /Windows|\.ssh/.test(a)), JSON.stringify(allow().slice(-3)));
postCmd({ BypassSandbox: 'true', Cwd: plain, CommandLine: 'git commit -qm x' });
check('작업 위치(Cwd)만으로는 넣지 않음', !allow().includes(wr(plain)), JSON.stringify(allow().slice(-3)));
check('명령에서 기억한 폴더도 기억 목록에 남음', JSON.parse(readFileSync(join(home, '.gemini', 'antigravity-implant', 'folder-grants.json'), 'utf8')).write.some((x) => x.folder === dst && /BypassSandbox/.test(x.from)), '');
rmSync(bp, { recursive: true, force: true, maxRetries: 3 });
rmSync(implCfg, { force: true });

const c = JSON.parse(readFileSync(cfgFile, 'utf8'));
check('다른 설정은 그대로', c.plugins.x === 1 && c.userSettings.autoExecutionPolicy === 'A' && c.userSettings.globalPermissionGrants.allow[0] === 'command(git)', JSON.stringify(c).slice(0, 200));

// 앱이 옛 설정으로 덮어써 규칙이 빠진 상황 → 다음 요청 시작(PreInvocation)에서 다시 채움
const c2 = JSON.parse(readFileSync(cfgFile, 'utf8')); c2.userSettings.globalPermissionGrants.allow = ['command(git)']; writeFileSync(cfgFile, JSON.stringify(c2, null, 2));
const tdir = join(home, 'conv', '.system_generated', 'logs'); mkdirSync(tdir, { recursive: true });
const tf = join(tdir, 'transcript_full.jsonl');
writeFileSync(tf, JSON.stringify({ step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: '<USER_REQUEST>hi</USER_REQUEST>' }) + '\n');
spawnSync(process.execPath, [join(hooks, 'pre_invocation.mjs')], { input: JSON.stringify({ conversationId: randomUUID(), transcriptPath: tf, modelName: 'gemini', invocationNum: 0 }), encoding: 'utf8', env });
check('빠진 규칙을 요청 시작 때 다시 채움', allow().includes(`read_file(${M}\\)`) && allow().includes(`write_file(${M}\\)`), JSON.stringify(allow()));
check('기억 목록 파일', JSON.parse(readFileSync(join(home, '.gemini', 'antigravity-implant', 'folder-grants.json'), 'utf8')).read.length === 1, '');

if (jnOk) { try { rmdirSync(jn); } catch {} } // 정션 자체만 먼저 지운다
rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
rmSync(home, { recursive: true, force: true });
console.log(fails ? `\n${fails}개 실패` : '\n전부 통과');
process.exitCode = fails ? 1 : 0;
