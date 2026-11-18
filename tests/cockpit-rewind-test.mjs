// 패널(사이드카) 되돌리기 API 시험: 서버를 띄우고 /api/checkpoints → /api/checkpoint-diff → /api/rewind
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import http from 'node:http';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'antigravity-implant');
const repo = mkdtempSync(join(tmpdir(), 'agyc-ck-'));
const conv = randomUUID();
const DATA = join(homedir(), '.gemini', 'antigravity-implant');
const stateFile = join(DATA, 'state', conv + '.json');
const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', windowsHide: true }).trim();
let fails = 0;
const check = (n, c, d) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '\n      ' + d}`); if (!c) fails++; };

// 앱의 sidecar_sdk 가 없는 PC 에서는 패널을 띄울 수 없으므로 건너뛴다
const sdkDirs = [process.env.ANTIGRAVITY_SIDECAR_SDK_DIR, join(root, 'sidecars', 'live-cockpit', 'sdk'), join(homedir(), '.gemini', 'config', 'node_modules', 'sidecar_sdk'), join(homedir(), '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk')].filter(Boolean);
if (!sdkDirs.some((d) => existsSync(join(d, 'index.mjs')))) { console.log('SKIP  Antigravity 의 sidecar_sdk 가 없어 패널 시험을 건너뜀'); rmSync(repo, { recursive: true, force: true }); process.exit(0); }
g('init', '-q'); writeFileSync(join(repo, 'a.txt'), 'original\n'); g('add', '-A'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'i');
spawnSync(process.execPath, [join(root, 'hooks', 'checkpoint_worker.mjs'), conv, '0', Buffer.from(JSON.stringify({ dirs: [repo], userText: '시험 요청' })).toString('base64')]);
writeFileSync(join(repo, 'a.txt'), 'broken\n');

const TOKEN = 'test-token-' + randomUUID();
const H = { 'Content-Type': 'application/json', 'X-Sidecar-Token': TOKEN };
// 서버 띄우기: 무작위 포트로, 한 번에 최대 20초 기다리고, 안 되면(포트 겹침·PC 바쁨) 다른 포트로 최대 3번
let srv, srvErr = '', port, base, up = false;
for (let attempt = 0; attempt < 3 && !up; attempt++) {
  port = 40000 + Math.floor(Math.random() * 20000);
  srvErr = '';
  srv = spawn(process.execPath, ['main.mjs'], { cwd: join(root, 'sidecars', 'live-cockpit'), env: { ...process.env, ANTIGRAVITY_SIDECAR_UI_TOKEN: TOKEN, ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:1', ANTIGRAVITY_CSRF_TOKEN: 'x', ANTIGRAVITY_SIDECAR_WEB_PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', (d) => { srvErr += d; });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80 && !up; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { up = (await fetch(`${base}/api/conversations`)).ok; } catch {}
    if (srv.exitCode != null) break;
  }
  if (!up) srv.kill();
}
if (!up) { console.log('FAIL  패널 서버가 뜨지 않음\n      ' + srvErr.slice(0, 800)); srv.kill(); rmSync(repo, { recursive: true, force: true }); process.exit(1); }
try {
  const list = await (await fetch(`${base}/api/checkpoints?conversationId=${conv}`)).json();
  check('목록 API: 체크포인트 1개', list.items && list.items.length === 1 && list.items[0].userText === '시험 요청', JSON.stringify(list));
  const id = list.items[0].id;
  const diff = await (await fetch(`${base}/api/checkpoint-diff?conversationId=${conv}&id=${encodeURIComponent(id)}`)).json();
  check('변경 API: a.txt 가 바뀐 것으로 보임', /a\.txt/.test(diff.names || ''), JSON.stringify(diff));
  const rw = await (await fetch(`${base}/api/rewind`, { method: 'POST', headers: H, body: JSON.stringify({ conversationId: conv, id }) })).json();
  check('되돌리기 API: 성공하고 a.txt 복원', rw.ok && readFileSync(join(repo, 'a.txt'), 'utf8') === 'original\n', JSON.stringify(rw) + ' / ' + readFileSync(join(repo, 'a.txt'), 'utf8'));
  const list2 = await (await fetch(`${base}/api/checkpoints?conversationId=${conv}`)).json();
  check('되돌리기 직전 상태가 목록에 추가', list2.items.length === 2 && list2.items[1].kind === 'undo' && !!list2.items[1].ref, JSON.stringify(list2));
  const note = join(DATA, 'rewound', conv);
  check('되돌린 뒤 에이전트용 알림 파일이 생김', existsSync(note) && /a\.txt/.test(readFileSync(note, 'utf8')), existsSync(note) ? readFileSync(note, 'utf8') : '없음');

  // 변경 보기: 훅이 기록한 작업 폴더만, UNC 는 거부, 쿼리로 넘긴 폴더는 무시
  const d0 = await (await fetch(`${base}/api/diff?conversationId=${conv}&workspaces=${encodeURIComponent(repo)}`)).json();
  check('변경 API: 기록 없는 대화는 쿼리 폴더를 무시', Array.isArray(d0.repos) && d0.repos.length === 0, JSON.stringify(d0));
  mkdirSync(join(DATA, 'state'), { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ workspacePaths: ['\\\\evil-server\\share', repo] }));
  const d1 = await (await fetch(`${base}/api/diff?conversationId=${conv}`)).json();
  check('변경 API: 기록된 폴더만 보이고 UNC 는 빠짐', d1.repos.length === 1 && d1.repos[0].git === true, JSON.stringify(d1).slice(0, 300));
  // 색(테마) API: 앱 설정 파일은 가짜 홈(run-all)일 때만 만든다 — 진짜 ~/.gemini/config/config.json 은 건드리지 않는다
  const fakeHome = homedir().toLowerCase().startsWith(tmpdir().toLowerCase());
  if (fakeHome) {
    mkdirSync(join(homedir(), '.gemini', 'config'), { recursive: true });
    writeFileSync(join(homedir(), '.gemini', 'config', 'config.json'), JSON.stringify({ userSettings: { themeMode: 'THEME_MODE_DARK', customThemeSeedsDark: { background: '#1a1b26', foregroundOverride: '#A9B1D6', primary: 'red' } } }));
  }
  const th = await (await fetch(`${base}/api/theme`)).json();
  check('테마 API: 기본은 앱 따라가기', th.prefs && th.prefs.theme === 'app' && Array.isArray(th.themes), JSON.stringify(th));
  if (fakeHome) check('테마 API: 앱 색을 읽고 이상한 값(red)은 버림', th.app.mode === 'dark' && th.app.dark.bg === '#1A1B26' && th.app.dark.accent === null, JSON.stringify(th.app));
  const badTheme = await (await fetch(`${base}/api/ui-prefs`, { method: 'POST', headers: H, body: JSON.stringify({ theme: '../x' }) })).json();
  const badHex = await (await fetch(`${base}/api/ui-prefs`, { method: 'POST', headers: H, body: JSON.stringify({ theme: 'nord', accent: 'url(x)' }) })).json();
  check('색 저장 API: 모르는 테마·#RRGGBB 아닌 색은 거부', !!badTheme.error && !!badHex.error, JSON.stringify([badTheme, badHex]));
  if (fakeHome) {
    const okPref = await (await fetch(`${base}/api/ui-prefs`, { method: 'POST', headers: H, body: JSON.stringify({ theme: 'nord', accent: '#ff8800' }) })).json();
    const th2 = await (await fetch(`${base}/api/theme`)).json();
    check('색 저장 API: 저장하면 다음 읽기에 그대로', okPref.ok && th2.prefs.theme === 'nord' && th2.prefs.accent === '#FF8800', JSON.stringify([okPref, th2.prefs]));
  }
  const noTokPref = await fetch(`${base}/api/ui-prefs`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ theme: 'app' }) });
  check('색 저장 API: 토큰 없으면 거부', noTokPref.status === 401, String(noTokPref.status));
  const pr = await (await fetch(`${base}/api/preset`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'nope' }) })).json();
  check('모드 API: 모르는 이름은 거부', !!pr.error, JSON.stringify(pr));
  const emptyId = await fetch(`${base}/api/rewind`, { method: 'POST', headers: H, body: JSON.stringify({ conversationId: conv, id: '' }) });
  const dashId = await fetch(`${base}/api/rewind`, { method: 'POST', headers: H, body: JSON.stringify({ conversationId: conv, id: '--json' }) });
  const noTok = await fetch(`${base}/api/live-rules`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ text: 'x' }) });
  check('토큰 없는 POST 는 거부 (다른 웹페이지의 몰래 요청 차단)', noTok.status === 401, String(noTok.status));
  const badHost = await new Promise((res) => { const rq = http.request({ host: '127.0.0.1', port, path: '/', headers: { Host: 'evil.example:' + port } }, (r) => { r.resume(); res(r.statusCode); }); rq.on('error', () => res(0)); rq.end(); });
  check('다른 호스트 이름으로 온 요청은 거부 (DNS rebinding 차단)', badHost === 403, String(badHost));
  const xs = await fetch(`${base}/api/conversations`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  const xo = await fetch(`${base}/api/conversations`, { headers: { Origin: 'https://evil.example' } });
  const so = await fetch(`${base}/api/conversations`, { headers: { 'Sec-Fetch-Site': 'same-origin', Origin: base } });
  check('다른 사이트에서 온 /api GET 은 거부 (이미지 태그 등 몰래 요청)', xs.status === 403 && xo.status === 403 && so.ok, `${xs.status} ${xo.status} ${so.status}`);
  const page = await (await fetch(`${base}/`)).text();
  check('패널 페이지에 토큰이 들어가 preload 보다 먼저 주소에 붙음', page.indexOf('__IMPLANT_TOKEN') >= 0 && page.indexOf('__IMPLANT_TOKEN') < page.indexOf('/preload.js'), '');
  check('되돌리기 API: 빈 번호·옵션 같은 번호는 거부 (마지막 것으로 덮어쓰지 않음)', emptyId.status === 400 && dashId.status === 400, `${emptyId.status} ${dashId.status}`);
} finally {
  srv.kill();
  rmSync(repo, { recursive: true, force: true });
  rmSync(join(DATA, 'rewound', conv), { force: true });
  rmSync(stateFile, { force: true });
  rmSync(join(DATA, 'checkpoints', conv + '.json'), { force: true });
}
console.log(fails ? `\n${fails}개 실패` : '\n전부 통과');
process.exitCode = fails ? 1 : 0;
