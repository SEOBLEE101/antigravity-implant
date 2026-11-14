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
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
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
export function folderFor(path) {
  if (!/^[a-z]:[\\/]/i.test(String(path || ''))) return null;
  const orig = win32.resolve(String(path)).replace(/\\+$/, ''); // C:\a\..\Windows\x → C:\Windows\x
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

export function onPostToolUse(input) {
  if (existsSync(join(DATA_DIR, 'off'))) return;
  const cfg = loadConfig();
  if (!cfg.enabled || cfg.folderGrants === false) return;
  if (input.error) return; // 거부됐거나 실패
  const call = input.toolCall || {};
  const kind = READ_TOOLS.has(call.name) ? 'read' : WRITE_TOOLS.has(call.name) ? 'write' : null;
  const path = argPath(call.args); // 상대 경로는 작업 폴더 안이라 대상이 아니다 → 절대 경로만
  if (!kind || !path || !/^[a-z]:[\\/]/i.test(path)) return;
  if ((input.workspacePaths || []).some((w) => within(win32.resolve(path), w))) return; // 작업 폴더 안
  const folder = folderFor(path);
  if (!folder) return;
  const added = addToConfig([ruleOf(kind, folder)]);
  if (!added) return; // 이미 앱 설정의 규칙이 덮고 있음 (또는 쓰기 실패) → 기억할 것 없음
  const g = load(GRANTS, { read: [], write: [] });
  const list = (g[kind] ||= []);
  if (!list.some((x) => within(folder, x.folder))) {
    list.push({ folder, at: new Date().toISOString(), from: String(path).slice(0, 260) });
    save(GRANTS, g);
  }
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
