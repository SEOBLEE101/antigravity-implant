// 체크포인트: 작업 폴더(git 저장소)의 지금 상태를 "사진"으로 남긴다. 작업 폴더·인덱스·브랜치는 건드리지 않는다.
//  - 임시 인덱스(GIT_INDEX_FILE)에 추적 파일 변경(add -u) + 새 파일(비밀·대용량 제외)을 담아 트리를 만들고 commit-tree
//  - refs/agyc/<대화>/<턴> 에 걸어 두어 git gc 로 지워지지 않게 하고, 목록에서 밀려난 것은 ref 를 지운다
//  - .gitignore 된 파일, 비밀 파일 패턴(.env, *.pem, *.key, credentials …), 5MB 넘는 새 파일은 담지 않는다
// Claude Code 의 체크포인트(/rewind), Codex 의 undo 를 흉내 낸 것.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DATA_DIR, atomicWrite, ID_RE } from './common.mjs';

export const CP_DIR = join(DATA_DIR, 'checkpoints');
const MAX_NEW_FILE = 5 * 1024 * 1024;
const KEEP = 50;
// 줄바꿈 변환 끔(바이트 그대로), 외부 프로그램(fsmonitor·diff 외부 도구·textconv) 실행 끔
const GIT_SAFE = ['-c', 'user.name=antigravity-implant', '-c', 'user.email=agyc@localhost', '-c', 'core.quotepath=off',
  '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.fsmonitor=false',
  // 메모리 절약: 자동 gc 끔, 팩 매핑 상한, 스레드 1개
  '-c', 'gc.auto=0', '-c', 'core.packedGitLimit=256m', '-c', 'core.packedGitWindowSize=32m', '-c', 'pack.threads=1'];
const MAX_UNTRACKED = 5000; // 새 파일이 이보다 많으면 새 파일은 담지 않는다 (빌드 산출물 폴더 등)
const HOME_ROOT = homedir().replace(/[\\/]+$/, '').toLowerCase();
const SECRET_RE = /(^|[\\/])(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore|jks)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*credential.*|.*secret.*|\.npmrc|\.pypirc|\.netrc|.*\.kdbx)$/i;

function git(cwd, args, opts = {}) {
  return execFileSync('git', [...GIT_SAFE, '-C', cwd, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: opts.timeout || 20000, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...(opts.env || {}) }, input: opts.input, stdio: [opts.input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
}
const lines0 = (s) => String(s || '').split('\0').filter(Boolean);

export function repoRoot(dir) {
  try { return git(dir, ['rev-parse', '--show-toplevel'], { timeout: 5000 }).trim(); } catch { return null; }
}

function tmpIndex() {
  mkdirSync(join(DATA_DIR, 'tmp'), { recursive: true });
  return join(DATA_DIR, 'tmp', `index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

// 지금 상태의 사진을 찍는다. 반환: { repo, commit, tree, parent, skipped } 또는 null
export function snapshot(dir, refName) {
  const repo = repoRoot(dir);
  if (!repo) return null;
  // 사용자 폴더 전체나 드라이브 전체가 저장소면 너무 커서 찍지 않는다
  const norm = repo.replace(/\//g, '\\').replace(/[\\]+$/, '').toLowerCase();
  if (norm === HOME_ROOT.replace(/\//g, '\\') || /^[a-z]:$/.test(norm) || norm === '') return null;
  const idx = tmpIndex();
  const env = { GIT_INDEX_FILE: idx };
  try {
    let parent = null;
    try { parent = git(repo, ['rev-parse', '--verify', 'HEAD'], { timeout: 5000 }).trim(); } catch {}
    if (parent) git(repo, ['read-tree', parent], { env });
    git(repo, ['add', '-u', '--', '.'], { env, timeout: 30000 });                   // 추적 파일의 변경·삭제
    let untracked = lines0(git(repo, ['ls-files', '-o', '--exclude-standard', '-z'], { timeout: 30000 }));
    const skipped = [];
    if (untracked.length > MAX_UNTRACKED) { skipped.push(`(새 파일 ${untracked.length}개 — 너무 많아 새 파일은 담지 않음)`); untracked = []; }
    const take = untracked.filter((f) => {
      if (SECRET_RE.test(f)) { skipped.push(f); return false; }
      try { if (statSync(join(repo, f)).size > MAX_NEW_FILE) { skipped.push(f); return false; } } catch { return false; }
      return true;
    });
    if (take.length) git(repo, ['add', '--pathspec-from-file=-', '--pathspec-file-nul', '--'], { env, input: take.join('\0') + '\0', timeout: 30000 });
    const tree = git(repo, ['write-tree'], { env }).trim();
    const commit = git(repo, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `antigravity-implant checkpoint ${refName || ''}`.trim()]).trim();
    if (refName) git(repo, ['update-ref', `refs/agyc/${refName}`, commit]);
    return { repo, commit, tree, parent, skipped };
  } finally {
    try { rmSync(idx, { force: true }); } catch {}
  }
}

export function loadCheckpoints(conv) {
  if (!ID_RE.test(String(conv || ''))) return [];
  try { return JSON.parse(readFileSync(join(CP_DIR, conv + '.json'), 'utf8')); } catch { return []; }
}

// 저장할 때 목록에서 밀려난 체크포인트의 ref 를 지워 git 이 정리할 수 있게 한다.
export function saveCheckpoints(conv, list) {
  if (!ID_RE.test(String(conv || ''))) return;
  const dropped = list.length > KEEP ? list.slice(0, list.length - KEEP) : [];
  for (const c of dropped) if (c.ref) { try { git(c.repo, ['update-ref', '-d', `refs/agyc/${c.ref}`], { timeout: 5000 }); } catch {} }
  atomicWrite(join(CP_DIR, conv + '.json'), JSON.stringify(list.slice(-KEEP), null, 1));
}

// 체크포인트 이후 무엇이 바뀌었나 (지금 작업 폴더 vs 체크포인트)
export function changedSince(cp) {
  const now = snapshot(cp.repo, null);
  if (!now) return null;
  const stat = git(cp.repo, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--stat', cp.commit, now.commit]).trim();
  const names = git(cp.repo, ['diff', '--no-ext-diff', '--no-renames', '--name-status', cp.commit, now.commit]).trim();
  return { stat, names, nowCommit: now.commit };
}

// 체크포인트 시점으로 되돌린다. 되돌리기 직전 상태도 먼저 사진으로 남겨 "되돌리기의 되돌리기"가 가능하게 한다.
//  - 체크포인트에 있던 파일은 그때 내용으로 돌아간다 (이름이 바뀐 파일도 원래 이름으로)
//  - 체크포인트 이후 새로 생긴 파일은 지우지 않고 목록만 알려 준다
export function rewind(conv, cp) {
  const undoRef = `${String(conv).slice(0, 8)}/before-rewind-${Date.now()}`;
  const before = snapshot(cp.repo, undoRef);
  if (!before) throw new Error(`git 저장소를 찾을 수 없습니다: ${cp.repo}`);
  const diffArgs = ['diff', '--no-ext-diff', '--no-renames', '-z'];
  const added = lines0(git(cp.repo, [...diffArgs, '--name-only', '--diff-filter=A', cp.commit, before.commit]));
  const inCp = new Set(lines0(git(cp.repo, ['ls-tree', '-r', '-z', '--name-only', cp.commit])));
  const changed = lines0(git(cp.repo, [...diffArgs, '--name-only', cp.commit, before.commit])).filter((f) => inCp.has(f));
  if (changed.length) {
    const idx = tmpIndex();
    try {
      git(cp.repo, ['read-tree', cp.commit], { env: { GIT_INDEX_FILE: idx } });
      // 바뀐 파일만 체크포인트 내용으로 덮어쓴다 (경로는 stdin 으로: 명령줄 길이 제한 회피)
      git(cp.repo, ['checkout-index', '-f', '-z', '--stdin'], { env: { GIT_INDEX_FILE: idx }, input: changed.join('\0') + '\0', timeout: 30000 });
    } finally { try { rmSync(idx, { force: true }); } catch {} }
  }
  return { restored: changed, keptNewFiles: added, undoCommit: before.commit, undoRef };
}
