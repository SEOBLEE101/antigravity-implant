// 진단 (Claude Code 의 /doctor 처럼): Antigravity Implant 가 제대로 깔리고 도는지 읽기만 해서 점검한다. 아무것도 바꾸지 않는다.
// 사용: node doctor.mjs [--json]
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOME = homedir();
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_NAME = (() => { try { return JSON.parse(readFileSync(join(PLUGIN_ROOT, 'plugin.json'), 'utf8')).name; } catch { return 'antigravity-implant'; } })();
const DATA_DIR = join(HOME, '.gemini', 'antigravity-implant');
const APP_CONFIG = join(HOME, '.gemini', 'config', 'config.json');
const CLI_SETTINGS = join(HOME, '.gemini', 'antigravity-cli', 'settings.json');
const JSON_OUT = process.argv.includes('--json');

const results = [];
const ok = (area, msg) => results.push({ level: 'ok', area, msg });
const warn = (area, msg, fix) => results.push({ level: 'warn', area, msg, fix });
const bad = (area, msg, fix) => results.push({ level: 'bad', area, msg, fix });
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return undefined; } };
const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return null; } };
const ago = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };

// 1) 기본 도구
const nodeMajor = Number(process.versions.node.split('.')[0]);
nodeMajor >= 18 ? ok('도구', `node ${process.versions.node}`) : bad('도구', `node ${process.versions.node} (18 이상 필요)`, 'node 를 18 이상으로 업데이트');
const gitV = run('git', ['--version']);
gitV ? ok('도구', gitV) : warn('도구', 'git 없음 — 체크포인트·되돌리기·변경 보기가 꺼집니다', 'git 설치');
const pyV = run('python', ['--version']);
pyV ? ok('도구', pyV) : warn('도구', 'python 없음 — .py 문법 검사만 건너뜁니다');

// 2) 설치·켜짐
const installed = join(HOME, '.gemini', 'config', 'plugins', PLUGIN_NAME);
const appCfg = readJson(APP_CONFIG);
if (!existsSync(join(installed, 'plugin.json'))) bad('설치', `플러그인이 ${installed} 에 없습니다`, 'README 의 설치 명령 실행');
else {
  const iv = (readJson(join(installed, 'plugin.json')) || {}).version;
  const sv = (readJson(join(PLUGIN_ROOT, 'plugin.json')) || {}).version;
  ok('설치', `설치됨 (버전 ${iv || '?'})${resolve(installed) !== PLUGIN_ROOT && sv && sv !== iv ? ` — 원본은 ${sv}, 다시 복사 필요` : ''}`);
  const entry = appCfg && appCfg.plugins && appCfg.plugins[PLUGIN_NAME];
  if (entry && entry.enabled === false) bad('설치', '플러그인이 꺼져 있습니다', `agy plugin enable ${PLUGIN_NAME}`);
}
if (existsSync(join(HOME, '.gemini', 'agy-communicator'))) warn('설치', '옛 이름의 데이터 폴더(~/.gemini/agy-communicator)가 남아 있습니다', '다음 훅 실행 때 자동으로 옮겨집니다. 남아 있으면 내용을 확인하고 지워도 됩니다');
if (existsSync(join(DATA_DIR, 'off'))) warn('설치', `끄기 스위치가 켜져 있어 훅이 아무것도 안 합니다 (${join(DATA_DIR, 'off')})`, '그 파일을 지우면 다시 켜짐');

// 3) 훅 파일 — 실제로 앱이 읽는 설치본을 본다 (없으면 이 폴더)
const HOOK_ROOT = existsSync(join(installed, 'hooks.json')) ? installed : PLUGIN_ROOT;
const hooks = readJson(join(HOOK_ROOT, 'hooks.json'));
if (!hooks) bad('훅', 'hooks.json 을 읽을 수 없습니다(JSON 오류)');
else {
  const scripts = new Set();
  const walk = (o) => { if (!o || typeof o !== 'object') return; if (typeof o.command === 'string') { const m = o.command.match(/node\s+(\S+\.mjs)/); if (m) scripts.add(m[1]); } for (const v of Object.values(o)) walk(v); };
  walk(hooks);
  for (const s of scripts) {
    const f = join(HOOK_ROOT, s);
    if (!existsSync(f)) { bad('훅', `${s} 없음`); continue; }
    run(process.execPath, ['--check', f]) === null ? bad('훅', `${s} 문법 오류`, `node --check "${f}"`) : ok('훅', `${s} 정상`);
  }
}
const cfg = readJson(join(DATA_DIR, 'config.json'));
if (existsSync(join(DATA_DIR, 'config.json')) && (cfg === undefined || cfg === null || typeof cfg !== 'object')) bad('설정', `${join(DATA_DIR, 'config.json')} 이 올바른 JSON 객체가 아닙니다 — 기본값으로 동작`, 'JSON 문법 확인');
else ok('설정', cfg ? `사용자 설정 ${Object.keys(cfg).length}개 (모드: ${cfg.preset || 'standard'})` : '기본 설정 사용');

// 4) 최근 동작
const stDir = join(DATA_DIR, 'state');
try {
  const newest = readdirSync(stDir).filter((n) => n.endsWith('.json')).map((n) => statSync(join(stDir, n)).mtimeMs).sort((a, b) => b - a)[0];
  newest ? ok('동작', `훅이 마지막으로 돈 때: ${ago(Date.now() - newest)}`) : warn('동작', '훅이 돈 기록이 없습니다', '앱을 다시 시작하고 메시지를 하나 보내 보기');
} catch { warn('동작', '훅이 돈 기록이 없습니다', '앱을 다시 시작하고 메시지를 하나 보내 보기'); }
try {
  const log = readFileSync(join(DATA_DIR, 'errors.log'), 'utf8').trim().split('\n');
  const recent = log.filter((l) => Date.now() - Date.parse(l.slice(0, 24)) < 24 * 3600e3);
  recent.length ? warn('동작', `최근 하루 훅 오류 ${recent.length}건 — 마지막: ${recent[recent.length - 1].slice(0, 200)}`, `${join(DATA_DIR, 'errors.log')} 확인`) : ok('동작', '최근 하루 훅 오류 없음');
} catch { ok('동작', '훅 오류 기록 없음'); }

// 5) 패널(Live Cockpit)
const sc = appCfg && appCfg.sidecars && Object.keys(appCfg.sidecars).find((k) => k.startsWith(PLUGIN_NAME + '/'));
sc ? ok('패널', `Live Cockpit 등록됨 (${sc})`) : warn('패널', 'Live Cockpit 이 앱에 등록되지 않았습니다', 'Customizations → antigravity-implant → UI extensions → Live Cockpit 에서 켜기');
const sdk = [join(PLUGIN_ROOT, 'sidecars', 'live-cockpit', 'sdk', 'index.mjs'), join(HOME, '.gemini', 'config', 'node_modules', 'sidecar_sdk', 'index.mjs'), join(HOME, '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk', 'index.mjs')].find((p) => existsSync(p));
sdk ? ok('패널', `사이드카 SDK: ${sdk.replace(HOME, '~')}`) : bad('패널', 'Antigravity 의 sidecar_sdk 를 찾지 못했습니다', 'Antigravity 앱을 한 번 실행해 패널 기능을 내려받게 하기');

// 6) 권한
const allow = (appCfg && appCfg.userSettings && appCfg.userSettings.globalPermissionGrants && appCfg.userSettings.globalPermissionGrants.allow) || [];
ok('권한', `앱 전역 허용 규칙 ${allow.length}개`);
// 규칙은 앞부분 일치라 "command(Start-Process)" 는 모든 Start-Process 를 허락한다. 짧은 이름만 있는 넓은 규칙만 짚는다.
const risky = allow.filter((r) => /^command\((&|\.|remove-item|rm|del|rd|rmdir|format|start-process|stop-process|winget|choco|reg|iex|invoke-expression|powershell|pwsh|cmd|git push)\)$/i.test(r));
if (risky.length) warn('권한', `넓은 명령 허용: ${[...new Set(risky)].join(', ')}`, '앱 설정 → 권한에서 필요 없는 것 지우기');
const fg = readJson(join(DATA_DIR, 'folder-grants.json'));
if (fg) ok('권한', `폴더 단위로 기억한 허락: 읽기 ${(fg.read || []).length}개, 쓰기 ${(fg.write || []).length}개`);
const cli = readJson(CLI_SETTINGS);
if (cli && cli.statusLine && typeof cli.statusLine === 'object') {
  if (cli.statusLine.enabled === false) warn('CLI', '상태줄이 꺼져 있습니다 (statusLine.enabled: false)');
  // 명령에서 statusline.mjs 경로를 꺼낸다: 따옴표·슬래시·%USERPROFILE%·$env:USERPROFILE 모두
  const cmd = String(cli.statusLine.command || '');
  const m = cmd.match(/"([^"]*statusline\.mjs)"|'([^']*statusline\.mjs)'|(\S*statusline\.mjs)/i);
  const raw = m ? (m[1] || m[2] || m[3]) : '';
  const p = raw.replace(/%userprofile%/i, HOME).replace(/\$env:userprofile/i, HOME).replace(/^~(?=[\\/])/, HOME).replace(/\//g, '\\');
  if (!raw) warn('CLI', `상태줄 명령에서 statusline.mjs 를 찾지 못했습니다: ${cmd.slice(0, 120)}`);
  else if (!existsSync(p)) bad('CLI', `상태줄 스크립트가 없습니다: ${p}`, 'install.ps1 -StatusLine 다시 실행');
  else ok('CLI', '상태줄 설정됨');
}

// 7) 규칙 파일 크기 (파일마다 기준이 다르다)
for (const [f, max, why] of [
  [join(HOME, '.gemini', 'GEMINI.md'), 12000, '길면 앱이 내용 대신 경로만 넣을 수 있음'],
  [join(HOME, '.gemini', 'config', 'rules', 'implant-memory.md'), 3000, '/remember 스킬 기준 3000자'],
  [join(HOME, '.gemini', 'config', 'live_rules.md'), 2000, '훅이 앞 2000자만 넣음'],
]) {
  if (!existsSync(f)) continue;
  const n = readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '').length;
  n > max ? warn('규칙', `${f.replace(HOME, '~')} 가 ${n}자 — ${why}`, '줄이기') : ok('규칙', `${f.replace(HOME, '~')} ${n}자`);
}
const geminiMd = join(HOME, '.gemini', 'GEMINI.md');
if (existsSync(geminiMd)) {
  try {
    const rawMd = readFileSync(geminiMd, 'utf8');
    const rm = rawMd.match(/<!--\s*antigravity-implant:readable-replies:start\s+lang=([a-zA-Z0-9_-]+)\s*-->/);
    if (rm) ok('규칙', `읽기 쉬운 답 규칙 적용됨 (언어: ${rm[1]})`);
  } catch {}
}
// 다른 플러그인 스킬이 많으면 매 대화 첫 입력이 커진다 (참고 정보)
try {
  const pdir = join(HOME, '.gemini', 'config', 'plugins');
  let plugins = 0, skills = 0;
  for (const n of readdirSync(pdir)) {
    const e = appCfg && appCfg.plugins && appCfg.plugins[n];
    if (e && e.enabled === false) continue;
    if (!existsSync(join(pdir, n, 'plugin.json'))) continue;
    plugins++;
    try { skills += readdirSync(join(pdir, n, 'skills')).length; } catch {}
  }
  (skills > 80 ? warn : ok)('규칙', `켜진 플러그인 ${plugins}개, 스킬 ${skills}개${skills > 80 ? ' — 많을수록 매 대화 첫 입력이 커짐' : ''}`, skills > 80 ? '안 쓰는 플러그인 끄기: agy plugin disable <이름>' : undefined);
} catch {}

// 8) computer-use
const cuPy = join(HOME, '.gemini', 'antigravity', 'scratch', 'windows-computer-use-mcp', '.venv', 'Scripts', 'python.exe');
const mcp = readJson(join(HOME, '.gemini', 'config', 'mcp_config.json'));
const cuReg = mcp && mcp.mcpServers && Object.keys(mcp.mcpServers).some((k) => /computer/i.test(k));
if (cuReg) existsSync(cuPy) || !JSON.stringify(mcp).includes('windows-computer-use-mcp') ? ok('computer-use', 'MCP 등록됨') : bad('computer-use', 'MCP 는 등록됐지만 파이썬 환경이 없습니다', 'install-computer-use 스크립트 다시 실행');
else warn('computer-use', '데스크톱 조작 MCP 가 없습니다(선택 사항)', 'README 의 「computer-use 설치(선택)」');

// 9) 세션 메쉬
const MESH_DATA = process.env.ANTIGRAVITY_IMPLANT_DATA_DIR || DATA_DIR;
const meshMcpFile = join(HOOK_ROOT, 'mcp_config.json');
if (!existsSync(meshMcpFile)) {
  warn('세션 메쉬', `mcp_config.json 없음 (${meshMcpFile})`, existsSync(join(PLUGIN_ROOT, 'mcp_config.json')) ? '플러그인 다시 복사 필요' : undefined);
} else {
  const meshMcp = readJson(meshMcpFile);
  if (!meshMcp || typeof meshMcp !== 'object' || Array.isArray(meshMcp)) {
    bad('세션 메쉬', `${meshMcpFile} 이 올바른 JSON 객체가 아닙니다`, 'JSON 문법 확인');
  } else if (meshMcp.mcpServers && meshMcp.mcpServers['session-bridge']) {
    ok('세션 메쉬', 'mcp_config.json 정상 (session-bridge 등록)');
  } else {
    warn('세션 메쉬', 'mcp_config.json 에 session-bridge 서버가 없습니다', 'mcp_config.json 확인');
  }
}

const bridgeScript = join(HOOK_ROOT, 'mcp', 'session-bridge.mjs');
if (!existsSync(bridgeScript)) {
  bad('세션 메쉬', `mcp/session-bridge.mjs 없음 (${bridgeScript})`, '플러그인 파일 확인');
} else {
  run(process.execPath, ['--check', bridgeScript]) === null
    ? bad('세션 메쉬', 'mcp/session-bridge.mjs 문법 오류', `node --check "${bridgeScript}"`)
    : ok('세션 메쉬', 'mcp/session-bridge.mjs 정상');
}

const meshFile = join(MESH_DATA, 'mesh.json');
if (!existsSync(meshFile)) {
  ok('세션 메쉬', 'mesh.json 없음 (로컬 기본값 사용 — 원격 연결 시 `node cli/mesh.mjs init` 실행)');
} else {
  const meshCfg = readJson(meshFile);
  if (!meshCfg || typeof meshCfg !== 'object' || Array.isArray(meshCfg)) {
    bad('세션 메쉬', `${meshFile} 이 올바른 JSON 객체가 아닙니다`, 'JSON 문법 확인');
  } else {
    const tr = meshCfg.transports && typeof meshCfg.transports === 'object' ? meshCfg.transports : {};
    const active = [];
    if (!tr.local || tr.local.enabled !== false) active.push('로컬');
    if (tr.http && tr.http.enabled) {
      const peerCount = tr.http.peers && typeof tr.http.peers === 'object' ? Object.keys(tr.http.peers).length : 0;
      active.push(`Tailscale/HTTP(${tr.http.bindHost || '127.0.0.1'}:${tr.http.port || 47821}, 피어 ${peerCount}대)`);
    }
    if (tr.folder && tr.folder.enabled) {
      active.push(`공유 폴더(${tr.folder.rootDir ? '경로 지정됨' : '경로 미지정'})`);
    }
    if (tr.relay && tr.relay.enabled) {
      active.push(`중계(${tr.relay.url ? tr.relay.url : 'URL 미지정'})`);
    }
    const idLabel = typeof meshCfg.machineId === 'string' && meshCfg.machineId ? meshCfg.machineId : '미지정';
    const hasSecret = Boolean(typeof meshCfg.secret === 'string' && meshCfg.secret.trim());
    if (meshCfg.enabled === false) {
      warn('세션 메쉬', `비활성화됨 (machineId: ${idLabel}, enabled: false)`, 'mesh.json 또는 패널에서 활성화');
    } else {
      ok('세션 메쉬', `활성 (머신: ${idLabel}, 비밀키: ${hasSecret ? '설정됨' : '미설정'}, 통로: ${active.length ? active.join(', ') : '없음'})`);
    }
    if (tr.http && tr.http.enabled && (tr.http.bindHost === '0.0.0.0' || tr.http.bindHost === '::')) {
      warn('세션 메쉬', `HTTP 바인딩이 전체 인터페이스(${tr.http.bindHost})로 열려 있습니다`, '127.0.0.1 또는 Tailscale 사설 IP 로 제한 권장');
    }
    if (tr.folder && tr.folder.enabled && (!tr.folder.rootDir || !existsSync(tr.folder.rootDir))) {
      warn('세션 메쉬', '공유 폴더 통로가 켜져 있으나 대상 폴더를 찾을 수 없습니다', 'mesh.mjs init --folder <경로> 로 재설정');
    }
    if (tr.relay && tr.relay.enabled && (!tr.relay.url || !tr.relay.secret)) {
      warn('세션 메쉬', '중계 통로가 켜져 있으나 URL 또는 비밀키가 비어 있습니다', 'mesh.mjs init --relay <url> --relay-secret <비밀키>');
    }
  }
}

// 출력
if (JSON_OUT) { process.stdout.write(JSON.stringify({ plugin: PLUGIN_NAME, results }, null, 1) + '\n'); }
else {
  const icon = { ok: '✓', warn: '!', bad: '✗' };
  let area = '';
  for (const r of results) {
    if (r.area !== area) { area = r.area; process.stdout.write(`\n[${area}]\n`); }
    process.stdout.write(`  ${icon[r.level]} ${r.msg}${r.fix ? `\n      → ${r.fix}` : ''}\n`);
  }
  const nb = results.filter((r) => r.level === 'bad').length, nw = results.filter((r) => r.level === 'warn').length;
  process.stdout.write(`\n결과: 문제 ${nb}개, 주의 ${nw}개\n`);
}
