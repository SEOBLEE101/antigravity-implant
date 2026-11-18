// 훅이 띄우는 별도 프로세스: 체크포인트를 찍고 기록한다. 훅(에이전트)을 기다리게 하지 않으려고 따로 돈다.
// 사용: node --max-old-space-size=256 checkpoint_worker.mjs <conversationId> <turnIdx> <base64(JSON: {dirs, userText})>
// 상한: node 힙 256MB, git 명령 하나당 30초(checkpoint.mjs), 새 파일 5000개 초과면 새 파일 제외,
//       시간 초과가 난 저장소는 하루 건너뜀, 같은 대화의 작업자는 한 번에 하나만.
import { snapshot, repoRoot, loadCheckpoints, saveCheckpoints, deleteRef } from './lib/checkpoint.mjs';
import { logError, ID_RE, DATA_DIR, atomicWrite } from './lib/common.mjs';
import { mkdirSync, statSync, openSync, writeSync, closeSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCK_STALE_MS = 10 * 60 * 1000; // 이보다 오래된 잠금은 죽은 작업자의 것으로 본다

// 원자적 잠금: 파일을 'wx'(없을 때만 만들기)로 연다. 오래된 잠금만 치우고 한 번 더 시도.
function takeLock(lock) {
  mkdirSync(join(DATA_DIR, 'tmp'), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lock, 'wx');
      writeSync(fd, String(process.pid)); closeSync(fd);
      return true;
    } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { force: true }); else return false; } catch { return false; }
    }
  }
  return false;
}
function releaseLock(lock) {
  try { if (readFileSync(lock, 'utf8').trim() === String(process.pid)) rmSync(lock, { force: true }); } catch {}
}

const [conv, turn, payload] = process.argv.slice(2);
let lock = null;
try {
  if (!ID_RE.test(String(conv || ''))) throw new Error('bad conversation id');
  const lk = join(DATA_DIR, 'tmp', `worker-${conv}.lock`);
  if (!takeLock(lk)) process.exit(0); // 같은 대화의 작업자가 이미 돌고 있음
  lock = lk;
  const { dirs = [], userText = '' } = JSON.parse(Buffer.from(payload || '', 'base64').toString('utf8') || '{}');
  // 같은 저장소의 하위 폴더가 여러 개 와도 한 번만 찍는다
  const repos = [...new Set(dirs.slice(0, 4).map((d) => repoRoot(d)).filter(Boolean))];
  const slowFile = join(DATA_DIR, 'checkpoints', 'slow-repos.json');
  let slow = {};
  try { slow = JSON.parse(readFileSync(slowFile, 'utf8')) || {}; } catch {}
  const added = [];
  repos.forEach((repo, i) => {
    const key = repo.toLowerCase();
    if (slow[key] && Date.now() - slow[key] < 24 * 3600e3) return; // 지난번에 시간 초과가 난(너무 큰) 저장소
    const ref = `${conv.slice(0, 8)}/turn-${turn}-${Date.now()}-${i}`;
    let r;
    try { r = snapshot(repo, ref); } catch (e) {
      const why = String(e && (e.code || e.message) || e);
      const unsafe = e && e.code === 'UNSAFE_REPO_CONFIG';
      if (unsafe || /ETIMEDOUT|ENOBUFS|maxBuffer/i.test(why)) {
        slow[key] = Date.now();
        try { atomicWrite(slowFile, JSON.stringify(slow)); } catch {}
        logError('checkpoint_worker', new Error(`${repo}: ${unsafe ? '저장소 설정(.git/config)에 filter/include 같은 실행 설정이 있어' : `시간 초과(${why})`} — 이 저장소는 하루 동안 체크포인트를 건너뜀`));
      } else {
        logError('checkpoint_worker', new Error(`${repo}: ${why.slice(0, 300)}`));
      }
      return;
    }
    if (!r) return;
    const prev = [...loadCheckpoints(conv), ...added].reverse().find((c) => c.repo === r.repo && c.kind !== 'undo');
    if (prev && prev.tree === r.tree) { // 지난 체크포인트와 내용이 같으면 생략 (방금 만든 ref 도 지움)
      deleteRef(r.repo, `refs/agyc/${ref}`); // 저장소 훅(reference-transaction)이 돌지 않게 안전 설정으로
      return;
    }
    added.push({ id: `${turn}-${Date.now()}-${i}`, turn: Number(turn), at: new Date().toISOString(), repo: r.repo, commit: r.commit, tree: r.tree, ref, skipped: r.skipped.slice(0, 20), userText: String(userText).slice(0, 200) });
  });
  // 저장 직전에 다시 읽어 덧붙인다 (그 사이 되돌리기가 남긴 기록을 지우지 않게)
  if (added.length) saveCheckpoints(conv, [...loadCheckpoints(conv), ...added]);
} catch (e) { logError('checkpoint_worker', e); }
if (lock) releaseLock(lock);
process.exit(0);
