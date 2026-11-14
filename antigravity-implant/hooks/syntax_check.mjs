// PostToolUse: 에이전트가 파일을 고친 직후 문법만 빠르게 검사한다 (Claude Code 의 "고친 뒤 자동 검사"처럼).
//  - .js/.mjs/.cjs → node --check, .json → JSON 파싱, .py → 파이썬 ast 파싱(바이트로 읽어 BOM·인코딩 표기 존중, 파일을 만들지 않음)
//  - 결과는 ~/.gemini/antigravity-implant/syntax/<대화>.json 에 남기고, 다음 모델 호출 직전에 PreInvocation 이 알린다
//    (PostToolUse 의 injectSteps 는 무시되므로 파일로 넘긴다 — 실험으로 확인)
//  - 확실한 문법 오류만 기록한다. 검사기가 없거나(파이썬 미설치·스토어 바로가기), JSX·주석 달린 JSON 처럼 검사기가 모르는
//    문법이면 기록하지 않는다 (헛알림보다 놓치는 쪽이 낫다).
//  - 이 훅은 아무것도 막지 않는다. 항상 {} 를 낸다.
import { readFileSync, existsSync, statSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, basename } from 'node:path';
import { DATA_DIR, atomicWrite, ID_RE, loadConfig, logError, argPath, normKey } from './lib/common.mjs';

const MAX = 2 * 1024 * 1024;

function check(file) {
  const ext = extname(file).toLowerCase();
  try { if (!statSync(file).isFile() || statSync(file).size > MAX) return null; } catch { return null; }
  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    try { execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 5000, windowsHide: true }); return ''; }
    catch (e) {
      if (e.code === 'ETIMEDOUT' || e.code === 'ENOENT') return null;
      const err = String(e.stderr || e.message);
      if (!/SyntaxError/.test(err)) return null;
      // JSX·TypeScript 문법이 섞인 .js (번들러용) 는 node 가 모르는 문법이라 검사하지 않는다
      if (ext === '.js' && /Unexpected token '<'|Unexpected token ':'|Unexpected identifier '(type|interface|as)'/.test(err)) return null;
      return err.split(/\r?\n/).filter((l) => l.trim() && !/^\s*at |^Node\.js v/.test(l)).slice(0, 4).join(' / ');
    }
  }
  if (ext === '.json' || ext === '.jsonc') {
    const name = basename(file).toLowerCase();
    if (ext === '.jsonc' || /^(tsconfig|jsconfig)(\..*)?\.json$|^\.?(eslintrc|babelrc)|^settings\.json$|^launch\.json$|^tasks\.json$/.test(name)) return null; // 주석 허용 JSON
    let text = '';
    try { text = readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); } catch { return null; }
    try { JSON.parse(text); return ''; } catch (e) {
      // 주석·끝 쉼표를 지우면 읽히는 파일은 JSONC 로 보고 넘어간다
      const loose = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"\\])\/\/.*$/gm, '$1').replace(/,(\s*[}\]])/g, '$1');
      try { JSON.parse(loose); return null; } catch {}
      return e.message;
    }
  }
  if (ext === '.py') {
    try {
      execFileSync('python', ['-I', '-c', 'import ast,sys;ast.parse(open(sys.argv[1],"rb").read(),sys.argv[1])', file], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 5000, windowsHide: true });
      return '';
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ETIMEDOUT') return null; // 파이썬 없음
      const err = String(e.stderr || '');
      // 진짜 문법 오류만. 스토어 바로가기(python.exe 가짜)·다른 실패는 무시
      if (!/(SyntaxError|IndentationError|TabError):/.test(err)) return null;
      return err.split(/\r?\n/).filter((l) => l.trim() && !/^Traceback|^\s+File "<string>"/.test(l)).slice(-3).join(' / ') || null;
    }
  }
  return null; // 검사하지 않는 종류
}

// 같은 대화의 기록 파일을 여러 훅이 동시에 고치지 않게 짧은 잠금 (못 잡으면 잠깐 기다렸다 그냥 진행)
function withLock(file, fn) {
  const lock = file + '.lock';
  let fd = null;
  for (let i = 0; i < 20 && fd === null; i++) {
    try { fd = openSync(lock, 'wx'); } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 10000) unlinkSync(lock); } catch {}
      const until = Date.now() + 25; while (Date.now() < until) { /* wait */ }
    }
  }
  try { return fn(); } finally { if (fd !== null) { try { closeSync(fd); unlinkSync(lock); } catch {} } }
}

export function onPostToolUse(input) {
  if (existsSync(join(DATA_DIR, 'off'))) return;
  const cfg = loadConfig();
  if (!cfg.enabled || cfg.syntaxCheck === false) return;
  const conv = String(input.conversationId || '');
  if (!ID_RE.test(conv) || input.error) return;
  const file = argPath((input.toolCall || {}).args, (input.workspacePaths || [])[0]);
  if (!file) return;
  const f = join(DATA_DIR, 'syntax', conv + '.json');
  const key = normKey(file);
  const res = existsSync(file) ? check(file) : '';
  if (res === null) return;
  withLock(f, () => {
    let errs = {};
    try { errs = JSON.parse(readFileSync(f, 'utf8')) || {}; } catch {}
    // 지워진 파일의 옛 오류는 정리
    for (const k of Object.keys(errs)) if (!existsSync(errs[k].path || k)) delete errs[k];
    const had = !!errs[key];
    if (res) errs[key] = { path: file, msg: res.slice(0, 500), at: Date.now() };
    else delete errs[key];
    if (res || had) atomicWrite(f, JSON.stringify(errs));
  });
}

let raw = '';
try { raw = readFileSync(0, 'utf8').replace(/^\uFEFF/, ''); } catch {}
try { onPostToolUse(raw.trim() ? JSON.parse(raw) : {}); } catch (e) { logError('syntax_check', e); }
process.stdout.write('{}\n');
