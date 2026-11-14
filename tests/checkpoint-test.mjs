// 체크포인트·되돌리기 시험: 임시 git 저장소에서 사진 → 수정 → 되돌리기 → 취소
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'antigravity-implant');
const repo = mkdtempSync(join(tmpdir(), 'agyc-cp-'));
const conv = randomUUID();
const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', windowsHide: true }).trim();
let fails = 0;
const check = (n, c, d) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '\n      ' + d}`); if (!c) fails++; };
const rw = (...a) => spawnSync(process.execPath, [join(root, 'cli', 'rewind.mjs'), ...a], { encoding: 'utf8' });

g('init', '-q');
writeFileSync(join(repo, 'app.js'), 'const a = 1;\n');
writeFileSync(join(repo, 'notes.txt'), '메모 원본\n');
g('add', '-A'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
writeFileSync(join(repo, 'notes.txt'), '메모 커밋 안 한 수정\n'); // 체크포인트에 커밋 안 한 변경도 담겨야 함
const indexBefore = g('diff', '--cached', '--name-only');

// 훅이 하는 것처럼 워커를 직접 돌린다
const payload = Buffer.from(JSON.stringify({ dirs: [repo], userText: 'app.js 고쳐줘' })).toString('base64');
spawnSync(process.execPath, [join(root, 'hooks', 'checkpoint_worker.mjs'), conv, '0', payload], { encoding: 'utf8' });
const l1 = rw('list', conv);
check('체크포인트가 생김', /1\. .*app\.js 고쳐줘/.test(l1.stdout), l1.stdout + l1.stderr);
check('작업 폴더·인덱스를 건드리지 않음', g('diff', '--cached', '--name-only') === indexBefore && readFileSync(join(repo, 'notes.txt'), 'utf8') === '메모 커밋 안 한 수정\n', g('status', '--short'));

// 에이전트가 고친 것처럼
writeFileSync(join(repo, 'app.js'), 'const a = 999; // 망가뜨림\n');
writeFileSync(join(repo, 'new.js'), 'new file\n');
const d = rw('diff', conv, '1');
check('diff: 바뀐 파일이 보임', /app\.js/.test(d.stdout) && /new\.js/.test(d.stdout), d.stdout + d.stderr);

const r = rw('restore', conv, '1');
check('restore: 성공', r.status === 0, r.stdout + r.stderr);
check('restore: app.js 가 체크포인트 내용으로', readFileSync(join(repo, 'app.js'), 'utf8') === 'const a = 1;\n', readFileSync(join(repo, 'app.js'), 'utf8'));
check('restore: 커밋 안 했던 수정도 그때 내용 유지', readFileSync(join(repo, 'notes.txt'), 'utf8') === '메모 커밋 안 한 수정\n', readFileSync(join(repo, 'notes.txt'), 'utf8'));
check('restore: 새 파일은 지우지 않고 알려 줌', existsSync(join(repo, 'new.js')) && /new\.js/.test(r.stdout), r.stdout);
check('restore: 실제 인덱스는 그대로', g('diff', '--cached', '--name-only') === indexBefore, g('diff', '--cached', '--name-only'));

const u = rw('undo', conv);
check('undo: 되돌리기 취소하면 망가뜨린 내용이 돌아옴', u.status === 0 && readFileSync(join(repo, 'app.js'), 'utf8') === 'const a = 999; // 망가뜨림\n', u.stdout + u.stderr + readFileSync(join(repo, 'app.js'), 'utf8'));

// git 저장소가 아니면 조용히 아무것도 안 함
const plain = mkdtempSync(join(tmpdir(), 'agyc-plain-'));
const conv2 = randomUUID();
spawnSync(process.execPath, [join(root, 'hooks', 'checkpoint_worker.mjs'), conv2, '0', Buffer.from(JSON.stringify({ dirs: [plain] })).toString('base64')], { encoding: 'utf8' });
check('git 저장소가 아니면 체크포인트 없음', /체크포인트 없음/.test(rw('list', conv2).stdout), rw('list', conv2).stdout);

// 새 파일이 너무 많으면(5000개 초과) 새 파일은 빼고 찍는다 (메모리·시간 보호)
const big = mkdtempSync(join(tmpdir(), 'agyc-big-'));
execFileSync('git', ['-C', big, 'init', '-q']);
writeFileSync(join(big, 'keep.txt'), 'k'); execFileSync('git', ['-C', big, 'add', '-A']); execFileSync('git', ['-C', big, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'i']);
mkdirSync(join(big, 'gen'));
for (let i = 0; i < 5001; i++) writeFileSync(join(big, 'gen', `f${i}.txt`), '');
const { snapshot } = await import(pathToFileURL(join(root, 'hooks', 'lib', 'checkpoint.mjs')).href);
const t0 = Date.now();
const snap = snapshot(big, null);
check('새 파일 5000개 초과: 새 파일은 빼고 빠르게 찍음', snap && snap.skipped.some((s) => /너무 많아/.test(s)) && Date.now() - t0 < 30000, JSON.stringify(snap && snap.skipped.slice(0, 2)) + ` ${Date.now() - t0}ms`);
rmSync(big, { recursive: true, force: true });

// 저장소 자체 설정에 filter 프로그램이 있으면 찍지 않는다 (git add 가 그 프로그램을 실행할 수 있음)
const evil = mkdtempSync(join(tmpdir(), 'agyc-evil-'));
execFileSync('git', ['-C', evil, 'init', '-q']);
writeFileSync(join(evil, 'a.txt'), 'x'); execFileSync('git', ['-C', evil, 'add', '-A']); execFileSync('git', ['-C', evil, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'i']);
execFileSync('git', ['-C', evil, 'config', '--local', 'filter.pwn.clean', 'node -e "require(\'fs\').writeFileSync(\'PWNED\',\'1\')"']);
writeFileSync(join(evil, '.gitattributes'), '*.txt filter=pwn\n'); writeFileSync(join(evil, 'a.txt'), 'changed');
let refused = false;
try { snapshot(evil, null); } catch (e) { refused = e.code === 'UNSAFE_REPO_CONFIG'; }
check('저장소 설정에 filter 가 있으면 찍지 않고, 그 프로그램도 실행되지 않음', refused && !existsSync(join(evil, 'PWNED')), `refused=${refused} pwned=${existsSync(join(evil, 'PWNED'))}`);
rmSync(evil, { recursive: true, force: true });

rmSync(repo, { recursive: true, force: true }); rmSync(plain, { recursive: true, force: true });
console.log(fails ? `\n${fails}개 실패` : '\n전부 통과');
process.exitCode = fails ? 1 : 0;
