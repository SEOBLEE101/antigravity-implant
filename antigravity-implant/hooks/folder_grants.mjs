// 폴더 단위 허락: 작업 폴더 밖 파일을 처음 쓸 때는 Antigravity 가 평소처럼 묻는다.
// 사용자가 허락해서 도구가 성공하면(PostToolUse), 그 파일이 있는 폴더의 진짜 허용 규칙을
// Antigravity 전역 권한 목록(~/.gemini/config/config.json)에 넣는다 → 다음부터 그 폴더는 묻지 않는다.
//
// 왜 이렇게 하나 (이 PC 실험, 2026-11-14):
//  - PreToolUse 의 allow / permissionOverrides 로는 "작업 폴더 밖 파일 접근" 검사를 넘길 수 없었다.
//  - config.json 전역 목록에 넣은 폴더 규칙은 재시작 없이 바로 적용됐다(경로 앞부분 기준).
//  - PreToolUse 는 실패하면 모든 도구를 막으므로 쓰지 않는다. PostToolUse 는 실패해도 아무것도 막지 않는다.
//
// 안전: 홈·드라이브 맨 위, 홈 바로 아래 폴더(문서·바탕화면·다운로드 …), 시스템 폴더, AppData, 점(.)으로 시작하는
//       폴더는 넓히지 않는다(파일마다 계속 묻는다). 경로의 .. 는 먼저 정리한다. 폴더 목록 보기·검색(list_dir 등)만으로는
//       기억하지 않는다(파일을 읽거나 쓴 것만). 읽기와 쓰기는 따로. 기억한 폴더는 folder-grants.json 에도 적어 두고,
//       앱이 옛 설정으로 덮어써 규칙이 빠지면 syncGrants() 가 다시 채운다.
// 사용: node folder_grants.mjs   (PostToolUse)
import { readFileSync, existsSync, appendFileSync, mkdirSync, statSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, atomicWrite, argPath, loadConfig } from './lib/common.mjs';

const GRANTS = join(DATA_DIR, 'folder-grants.json');
const CONFIG = join(homedir(), '.gemini', 'config', 'config.json');

const READ_TOOLS = new Set(['read_file', 'view_file', 'view_file_outline']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content']);

const norm = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const within = (p, dir) => { const a = norm(p), b = norm(dir); return !!b && (a === b || a.startsWith(b + '\\')); };

// 폴더 단위로 넓혀도 되는 폴더 (원래 대소문자 표기, 백슬래시). 안 되면 null.
// Windows 는 같은 폴더를 여러 표기로 가리킬 수 있다: 끝의 점·공백("C:\Windows.\x"), 짧은 이름("C:\PROGRA~1"),
// 대체 데이터 스트림("a.txt:x"), "\\?\" 접두사. 이런 표기는 제외 규칙을 비껴갈 수 있으므로 아예 넓히지 않는다.
const ODD_SEGMENT = (s) => /[. ]$/.test(s) || /~\d/.test(s) || s.includes(':');
export function folderFor(path) {
  const raw = String(path || '');
  if (!/^[a-z]:[\\/]/i.test(raw) || raw.startsWith('\\\\')) return null;
  if (raw.slice(2).split(/[\\/]+/).some((s) => s && s !== '.' && s !== '..' && ODD_SEGMENT(s))) return null;
  const orig = win32.resolve(raw).replace(/\\+$/, ''); // C:\a\..\Windows\x → C:\Windows\x
  const dirOrig = win32.dirname(orig);
  const dir = norm(dirOrig);
  const home = norm(homedir());
  const parts = dir.split('\\');
  if (parts.length < 2) return null;                                       // 드라이브 맨 위
  if (dir === home || dir === norm(dirname(homedir()))) return null;       // 홈 맨 위, C:\Users
  if (norm(win32.dirname(dir)) === home) return null;                      // 홈 바로 아래 (Documents, Desktop, Downloads …)
  if (parts.some((s) => s.startsWith('.') && s.length > 1)) return null;   // .ssh .gemini .claude …
  if (/^[a-z]:\\(windows|program files|program files \(x86\)|programdata|\$recycle\.bin|system volume information|recovery)(\\|$)/.test(dir)) return null;
  if (dir === home + '\\appdata' || dir.startsWith(home + '\\appdata\\')) return null;
  return dirOrig;
}

// 경로가 가리키는 실제 위치(realpath)가 적힌 경로와 같은가 (대소문자 무시). 파일이 아직 없으면(새로 쓸 파일) 그 폴더로 본다.
// 경로의 어느 단계든 정션·심볼릭 링크·짧은 이름이면 실제 위치가 달라지므로 false. 확인을 못 하면 false.
export function samePlace(path) {
  if (!/^[a-z]:[\\/]/i.test(String(path || ''))) return false;
  const want = win32.resolve(String(path));
  let target = want, real;
  try { real = realpathSync.native(target); } catch {
    target = win32.dirname(want);
    try { real = realpathSync.native(target); } catch { return false; }
  }
  return norm(real) === norm(target);
}

function load(f, d) { try { return JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return d; } }
function save(f, v) { atomicWrite(f, JSON.stringify(v, null, 1)); }

// 규칙 끝에 \ 를 붙인다: 앞부분 일치라 "D:\proj" 는 "D:\project-x" 도 허락해 버리기 때문 (끝에 \ 를 붙이면 폴더 안만 — agy CLI 로 확인)
const ruleOf = (kind, folder) => `${kind === 'read' ? 'read_file' : 'write_file'}(${String(folder).replace(/\\+$/, '')}\\)`;

// 전역 권한 목록에 규칙을 넣는다. 이미 더 넓은 규칙이 덮고 있으면 넣지 않는다. 넣은 개수를 돌려준다.
export function addToConfig(rules) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let raw, c;
    try { raw = readFileSync(CONFIG, 'utf8'); c = JSON.parse(raw.replace(/^﻿/, '')); } catch { return 0; } // 못 읽으면 건드리지 않는다
    if (!c || typeof c !== 'object') return 0;
    const us = (c.userSettings ||= {});
    const g = (us.globalPermissionGrants ||= {});
    const allow = (g.allow ||= []);
    const covered = (r) => {
      const m = r.match(/^(read_file|write_file)\((.*)\)$/);
      return allow.some((a) => { const n = a.match(/^(read_file|write_file)\((.*)\)$/); return n && n[1] === m[1] && within(m[2], n[2]); });
    };
    const add = rules.filter((r) => !covered(r));
    if (!add.length) return 0;
    allow.push(...add);
    const indent = (raw.match(/\n([ \t]+)"/) || [, '  '])[1];
    const out = JSON.stringify(c, null, indent) + (raw.endsWith('\n') ? '\n' : '');
    if (readFileSync(CONFIG, 'utf8') !== raw) continue; // 그 사이 앱이 바꿨으면 다시
    try { atomicWrite(CONFIG, out); } catch { return 0; }
    return add.length;
  }
  return 0;
}

// 기억한 폴더가 전역 목록에서 빠졌으면 다시 넣는다 (PreInvocation 이 요청 시작 때 부른다).
export function syncGrants() {
  const g = load(GRANTS, { read: [], write: [] });
  const rules = [...(g.read || []).map((x) => ruleOf('read', x.folder)), ...(g.write || []).map((x) => ruleOf('write', x.folder))];
  return rules.length ? addToConfig(rules) : 0;
}

// 도구 인자는 가끔 JSON 문자열로 한 번 더 감싸져 온다 ("\"C:\\a\"" 나 "\"true\"") → 풀어서 쓴다
function argVal(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (/^"[\s\S]*"$/.test(t)) { try { return JSON.parse(t); } catch {} }
  return t;
}
const isTrue = (v) => { const x = argVal(v); return x === true || x === 'true'; };
const EXEC_RE = /\.(exe|dll|com|bat|cmd|ps1|psm1|psd1|vbs|js|mjs|cjs|py|msi|sys|lnk)$/i;

// 샌드박스 밖 실행(BypassSandbox)을 사용자가 허락해 성공한 명령에서, 그 명령이 다룬 폴더를 찾는다.
// 샌드박스의 쓰기 범위는 write_file(폴더\) 허용 규칙을 따른다(이 PC 의 agy CLI 실험, 2026-11-18) → 그 폴더에 쓰기
// 허락을 기억해 두면 다음부터는 같은 폴더 작업을 샌드박스 안에서 묻지 않고 한다. 실제로 있는 파일·폴더만, 최대 3개,
// 폴더 단위로 넓혀도 되는 곳(folderFor)만.
export function bypassFolders(args) {
  const a = args || {};
  const cmd = String(argVal(a.CommandLine || a.command || '') || '');
  const cands = [];
  // 작업 위치(Cwd)만으로는 넣지 않는다: 그 폴더에 실제로 썼는지 알 수 없다
  for (const m of cmd.matchAll(/(?:"([a-z]:[\\/][^"\r\n]*)"|'([a-z]:[\\/][^'\r\n]*)'|(?<![\w])([a-z]:[\\/][^\s"'`;|&<>()]*))/gi)) {
    let p = (m[1] || m[2] || m[3] || '').replace(/[\\/]+$/, '');
    if (!p || /[*?]/.test(p)) continue; // 와일드카드는 판단하지 않는다
    if (EXEC_RE.test(p)) continue; // 실행한 프로그램(C:\ffmpeg\bin\ffmpeg.exe 등)의 폴더에는 쓰기를 넓히지 않는다
    // 실제로 있고, 적힌 경로가 곧 실제 위치일 때만 (짧은 이름·정션·심볼릭 링크로 다른 곳을 가리키면 넓히지 않는다)
    if (!samePlace(p)) continue;
    try { cands.push(statSync(p).isDirectory() ? win32.join(p, '_') : p); } catch {} // 폴더 자체면 그 폴더, 파일이면 그 파일의 폴더
  }
  const out = [];
  for (const c of cands) {
    const f = folderFor(c);
    if (f && !out.some((x) => within(f, x))) out.push(f);
    if (out.length >= 3) break;
  }
  return out;
}

function remember(kind, folder, from) {
  const added = addToConfig([ruleOf(kind, folder)]);
  if (!added) return; // 이미 앱 설정의 규칙이 덮고 있음 (또는 쓰기 실패) → 기억할 것 없음
  const g = load(GRANTS, { read: [], write: [] });
  const list = (g[kind] ||= []);
  if (!list.some((x) => within(folder, x.folder))) {
    list.push({ folder, at: new Date().toISOString(), from: String(from).slice(0, 260) });
    save(GRANTS, g);
  }
}

export function onPostToolUse(input) {
  if (existsSync(join(DATA_DIR, 'off'))) return;
  const cfg = loadConfig();
  if (!cfg.enabled || cfg.folderGrants === false) return;
  if (input.error) return; // 거부됐거나 실패
  const call = input.toolCall || {};
  const inWorkspace = (p) => (input.workspacePaths || []).some((w) => within(win32.resolve(p), w));
  if (call.name === 'run_command') {
    // 기본은 꺼짐: 명령 글자만 보고는 그 명령이 정말 어디에 썼는지 알 수 없다. 사용자가 켰을 때만.
    if (cfg.folderGrantsFromCommands !== true || !isTrue((call.args || {}).BypassSandbox)) return;
    for (const folder of bypassFolders(call.args)) {
      if (!inWorkspace(folder)) remember('write', folder, 'run_command(BypassSandbox): ' + String(argVal((call.args || {}).CommandLine) || '').slice(0, 200));
    }
    return;
  }
  const kind = READ_TOOLS.has(call.name) ? 'read' : WRITE_TOOLS.has(call.name) ? 'write' : null;
  const path = argPath(call.args); // 상대 경로는 작업 폴더 안이라 대상이 아니다 → 절대 경로만
  if (!kind || !path || !/^[a-z]:[\\/]/i.test(path)) return;
  if (inWorkspace(path)) return; // 작업 폴더 안
  // 사용자가 허락한 경로가 실제 위치와 같을 때만 넓힌다. 정션·심볼릭 링크·짧은 이름으로 다른 곳을 가리키면
  // 사용자가 본 적 없는 실제 위치에 규칙을 쓰게 되므로 넓히지 않는다 (파일마다 계속 묻는다).
  if (!samePlace(path)) return;
  const folder = folderFor(path);
  if (!folder) return;
  remember(kind, folder, path);
}

// 직접 실행될 때 (PostToolUse 훅)
if (/folder_grants\.mjs$/i.test(String(process.argv[1] || '')) && fileURLToPath(import.meta.url)) {
  let raw = '';
  try { raw = readFileSync(0, 'utf8').replace(/^﻿/, ''); } catch {}
  try { onPostToolUse(raw.trim() ? JSON.parse(raw) : {}); } catch (e) {
    try { mkdirSync(DATA_DIR, { recursive: true }); appendFileSync(join(DATA_DIR, 'errors.log'), `${new Date().toISOString()} folder_grants ${e && e.stack || e}\n`); } catch {}
  }
  process.stdout.write('{}\n');
}
