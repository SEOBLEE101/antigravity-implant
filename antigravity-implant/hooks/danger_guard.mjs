// PreToolUse (run_command 만): 되돌릴 수 없는 위험한 터미널 명령을 막는다 (Claude Code 의 권한 deny 규칙처럼).
//
// 중요: PreToolUse 는 "닫힌 쪽으로 실패"한다 — 빈 응답·오류·시간 초과면 그 도구가 막힌다(실험 4-1).
//  그래서 이 파일은 node 내장 모듈만 쓰고, 무슨 일이 있어도 마지막에 JSON 한 줄을 낸다.
//  - 위험하지 않으면 {"decision":"ask"} = 평소 권한 설정 그대로 (allow 는 사용자 권한을 건너뛰므로 절대 쓰지 않는다)
//  - 위험하면 {"decision":"deny","reason":"…"}
//
// 판정 방식: 명령을 ; && || & 줄바꿈으로 문장을 나누고, | 로 파이프 단계를 나눈 뒤 단계마다 본다.
//  cmd /c "…", powershell -c "…", powershell -EncodedCommand <base64> 는 속 명령을 꺼내 다시 본다(최대 3겹).
//  따옴표 안의 글(커밋 메시지·검색어)은 명령 이름으로 보지 않는다. 경로는 .. 를 정리하고 환경 변수 표기도 본다.
// 두 등급:
//  1) 항상 막음: 드라이브·사용자 폴더·시스템 폴더 통째 삭제(파이프·robocopy /MIR·.NET 포함), 디스크 포맷/초기화,
//     부팅 설정, 복원 지점 삭제
//  2) 사용자가 이번 메시지에서 그 일을 말했을 때만 통과: 강제 푸시, reset --hard, clean -f, 레지스트리·영구 환경 변수·
//     서비스·실행 정책 변경, 인터넷에서 받은 스크립트 실행, 컴퓨터 끄기/재시작, 이 플러그인 자체를 끄는 명령,
//     풀 수 없는 인코딩 명령
// 한계: 명령 문자열만 본다. 스크립트 파일 안에 숨긴 명령이나 다른 도구(파일 편집)로 하는 일은 못 막는다.
import { readFileSync, existsSync } from 'node:fs';
import { join, win32 } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = join(homedir(), '.gemini', 'antigravity-implant');
const ID_RE = /^[0-9a-zA-Z-]{8,64}$/;
const MAX_DEPTH = 3;

// ---------- 문자열 쪼개기 ----------
// 따옴표 밖의 구분자로 문장(statement)과 파이프 단계(stage)를 나눈다. 반환: [[stage, stage…], …]
export function splitCommand(cmd) {
  const out = [];
  let stmt = [], cur = '', q = '';
  const endStage = () => { if (cur.trim()) stmt.push(cur.trim()); cur = ''; };
  const endStmt = () => { endStage(); if (stmt.length) out.push(stmt); stmt = []; };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i], nx = cmd[i + 1];
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '\n' || ch === '\r' || ch === ';') { endStmt(); continue; }
    if ((ch === '&' && nx === '&') || (ch === '|' && nx === '|')) { endStmt(); i++; continue; }
    if (ch === '&' && !/[>\d]/.test(cmd[i - 1] || '') && nx !== '>') { // cmd 의 & (2>&1 같은 건 제외)
      if (!cur.trim()) { cur += ch; continue; } // PowerShell 호출 연산자 "& .\x.ps1"
      endStmt(); continue;
    }
    if (ch === '|') { endStage(); continue; }
    cur += ch;
  }
  endStmt();
  return out;
}

// 따옴표를 지킨 토큰. "C:\Program Files" 는 한 토큰.
function tokenize(s) {
  return (s.match(/"[^"]*"?|'[^']*'?|\S+/g) || []).map((t) => t.replace(/^["']|["']$/g, ''));
}
const blankQuotes = (s) => s.replace(/"[^"]*"?|'[^']*'?/g, ' ');
const verbOf = (tok) => String(tok || '').toLowerCase().replace(/^&$/, '').replace(/^.*[\\/]/, '').replace(/\.(exe|com|cmd|bat)$/, '');

// cmd /c "…", powershell -c "…", -EncodedCommand → 속 명령
function innerCommands(stage) {
  const toks = tokenize(stage);
  const v = verbOf(toks[0] === '&' ? toks[1] : toks[0]);
  const res = [];
  if (v === 'cmd') {
    // cmd /c "…", cmd /c"…"(붙여 쓰기), cmd /s /c …
    const mm = stage.match(/\s\/[ck](?=[\s"])\s*([\s\S]*)$/i);
    if (mm) res.push(mm[1].trim().replace(/^"([\s\S]*)"$/, '$1').replace(/^"/, ''));
  }
  if (v === 'powershell' || v === 'pwsh') {
    const e = toks.findIndex((t) => /^-(e|ec|en|enc|enco|encod|encode|encoded|encodedc\w*)$/i.test(t));
    if (e >= 0) {
      let decoded = '';
      try { decoded = Buffer.from(String(toks[e + 1] || ''), 'base64').toString('utf16le'); } catch {}
      // \uc81c\ub300\ub85c \ud480\ub838\ub294\uc9c0: \ub300\ubd80\ubd84 \uc77d\uc744 \uc218 \uc788\ub294 \uae00\uc790(\ud55c\uae00 \uc8fc\uc11d \ub4f1 \ud3ec\ud568)\uc5ec\uc57c \ud55c\ub2e4. \uc544\ub2c8\uba74 \ud480 \uc218 \uc5c6\ub294 \uac83\uc73c\ub85c \ubcf4\uace0 \ud655\uc778 \uc694\uccad
      const readable = (decoded.match(/[\p{L}\p{N}\p{P}\p{S}\s]/gu) || []).length;
      const ascii = (decoded.match(/[\x20-\x7e]/g) || []).length;
      res.push(decoded.length >= 2 && readable / decoded.length > 0.95 && ascii / decoded.length > 0.3 ? decoded : '\u0000ENCODED');
    }
    const c = toks.findIndex((t) => /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(t));
    if (c >= 0) res.push(toks.slice(c + 1).join(' '));
    else if (toks.length > 1 && e < 0 && !toks.slice(1).some((t) => /^-(f|fi|fil|file)$/i.test(t))) {
      // powershell "Remove-Item …" 처럼 -Command 없이 바로 준 것
      const rest = toks.slice(1).filter((t) => !/^-(nop|noprofile|noni|noninteractive|ep|executionpolicy|bypass|windowstyle|w|hidden|nologo|sta|mta)$/i.test(t) && !/^(bypass|hidden|unrestricted|remotesigned)$/i.test(t));
      if (rest.length) res.push(rest.join(' '));
    }
  }
  return res;
}

// ---------- 경로 ----------
const VARS = '(\\$home|\\$\\{home\\}|\\$env:(userprofile|systemdrive|systemroot|windir|homedrive|programfiles|programdata)|\\$\\{env:(userprofile|systemdrive|systemroot|windir|homedrive|programfiles|programdata)\\}|%(userprofile|systemdrive|systemroot|windir|homedrive|programfiles|programdata)%|~)';
const ROOT_RE = new RegExp(
  `^(${VARS}([\\\\/]\\*?)?|[a-z]:([\\\\/]\\*?)?|[\\\\/]\\*?|[a-z]:[\\\\/]users([\\\\/][^\\\\/]+)?([\\\\/]\\*?)?|[a-z]:[\\\\/](windows|program files( \\(x86\\))?|programdata)([\\\\/].*)?)$`, 'i');
const HOME_LC = homedir().toLowerCase().replace(/[\\/]+$/, '');

export function normPath(t) {
  let p = String(t || '').trim();
  p = p.replace(/^-[a-z]+:(?=.)/i, ''); // -LiteralPath:C:\ → C:\
  p = p.replace(/^\\\\[?.]\\/, '').replace(/^\/\/[?.]\//, ''); // \\?\C:\ → C:\
  if (/^[a-z]:[\\/]|^[\\/]/i.test(p)) {
    // Windows 는 폴더 이름 끝의 점·공백을 버린다(C:\Windows. = C:\Windows). 그다음 . .. 와 겹친 \ 를 정리한다
    // (C:\Users\..\Windows → C:\Windows, C:\\ → C:\, C:\Users\me\. → C:\Users\me\)
    p = p.split(/([\\/]+)/).map((seg, i) => (i % 2 || seg === '.' || seg === '..' || seg === '*') ? seg : seg.replace(/[. ]+$/, '')).join('');
    const star = /[\\/]\*$/.test(p);
    p = win32.normalize(p);
    if (star && !/\*$/.test(p)) p += '*';
  }
  return p;
}
export function isRootTarget(t) {
  const p = normPath(t);
  if (!p || /^-/.test(p)) return false;
  if (ROOT_RE.test(p)) return true;
  const lc = p.toLowerCase().replace(/[\\/]+\*?$/, '');
  return lc === HOME_LC;
}

// ---------- 판정 ----------
const DEL_VERBS = new Set(['remove-item', 'ri', 'rm', 'rmdir', 'rd', 'del', 'erase']);
const RECURSE_TOK_RE = /^(-r(e(c(u(r(s(e)?)?)?)?)?)?(:\$?true)?|-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*|--recursive)$/i;
// cmd 의 옵션은 붙여 쓸 수 있다: /s/q, /q/s → 하나씩 나눠서 /s 가 있나 본다
const RECURSE_TOK = { test: (t) => RECURSE_TOK_RE.test(t) || (/^(\/[a-z?])+$/i.test(t) && /\/s(?![a-z])/i.test(t)) };
const LIST_VERBS = new Set(['get-childitem', 'gci', 'ls', 'dir']);

const ALWAYS = [
  [/\bformat(\.com)?\s+(\/\S+\s+)*[a-z]:/i, '디스크 포맷'], // format /FS:NTFS D: 처럼 옵션이 앞에 와도
  [/\b(format-volume|diskpart|clear-disk|initialize-disk|remove-partition|mkfs(\.\w+)?)\b/i, '디스크·파티션 초기화'],
  [/\bdd\s+[^|;&\r\n]*\bof=\/dev\//i, '디스크에 직접 쓰기'],
  [/\bbcdedit\b/i, '부팅 설정 변경'],
  [/\bvssadmin\s+delete\b|\bwmic\s+shadowcopy\s+delete\b|win32_shadowcopy[^|]*\|[^|]*\bremove-ciminstance\b/i, '복원 지점(섀도 복사본) 삭제'],
  [/\bcipher(\.exe)?\s+\/w\b/i, '디스크 빈 공간 덮어쓰기'],
];

// [판정 함수(stageInfo) → bool, 무엇, 사용자 메시지에 있으면 통과시키는 말]
const CONFIRM = [
  [(s) => s.git && s.git.sub === 'push' && s.git.args.some((a) => /^--force(-with-lease)?(=.*)?$|^--force-if-includes$/.test(a) || /^-[a-z]*f[a-z]*$/i.test(a) || /^\+/.test(a)), '강제 푸시(git push --force)', /(--force|force[- ]?push|\bpush\s+-f\b|강제\s*(푸시|push|로)|덮어\s*써서\s*푸시)/i],
  [(s) => s.git && s.git.sub === 'reset' && s.git.args.includes('--hard'), 'git reset --hard (커밋 안 한 변경 사라짐)', /(reset\s+--hard|하드\s*리셋|git\s+reset)/i],
  [(s) => s.git && s.git.sub === 'clean' && s.git.args.some((a) => /^-[a-z]*f/i.test(a) || a === '--force') && !s.git.args.some((a) => /^-[a-z]*n|^--dry-run$/i.test(a)), 'git clean -f (git 에 없는 파일 삭제)', /(git\s+clean|untracked|추적\s*(안|하지\s*않)\s*(된|는|은)\s*파일)/i],
  [(s) => /\b(reg(\.exe)?\s+(add|delete|import|load|unload|restore|copy)\b|\bhkey_(local_machine|current_user|classes_root|users))/i.test(s.bare) || isRegistryWrite(s), '레지스트리 변경', /(레지스트리|registry|\breg(\.exe)?\s|hklm|hkcu|hkcr|hku\b|hkcc)/i],
  [(s) => /\bsetx\b|\[(system\.)?environment\]::setenvironmentvariable\s*\([^)]*(machine|user)/i.test(s.text), '영구 환경 변수 변경', /(환경\s*변수|environment\s+variable|\bsetx\b)/i],
  [(s) => /\bset-executionpolicy\b/i.test(s.bare), '스크립트 실행 정책 변경', /(실행\s*정책|executionpolicy)/i],
  [(s) => /^(sc)$/.test(s.verb) && /^(delete|config|create|stop|failure)$/i.test(s.toks[1] || '') || /^(stop|set|remove|new|restart|suspend)-service$/.test(s.verb), '윈도우 서비스 변경', /(서비스\s*(를|을)?\s*(중지|멈춰|삭제|지워|바꿔|변경|만들어|재시작)|\bservices?\b\s*(stop|restart|delete|config)|\b(stop|restart|set|remove|new)-service\b|\bsc(\.exe)?\s+(stop|delete|config|create))/i],
  [(s) => (s.verb === 'shutdown' && s.toks.slice(1).some((a) => /^[\/-]/.test(a))) || /^(restart-computer|stop-computer)$/.test(s.verb), '컴퓨터 끄기·재시작', /(재부팅|재시작해|컴퓨터\s*(를|을)?\s*(꺼|끄|종료)|\bshutdown\b|\breboot\b|restart-computer|stop-computer)/i],
  [(s) => /antigravity-implant/i.test(s.text) && (/[\\/](off|config\.json|hooks\.json)\b/i.test(s.text) || /plugins[\\/]antigravity-implant/i.test(s.text)) && /(new-item|set-content|add-content|out-file|remove-item|\bri\b|\bdel\b|\brm\b|copy|move|\bni\b|>)/i.test(s.text), 'Antigravity Implant 자체를 끄거나 바꾸는 명령', /(implant|임플란트|훅\s*(을|를)?\s*(꺼|끄|지워)|플러그인\s*(을|를)?\s*(꺼|끄|지워))/i],
];

// 레지스트리를 바꾸는 PowerShell 명령: 명령 이름이 쓰기 동사이고, 인자(따옴표를 벗긴 것) 중 하나가 레지스트리 경로.
// 따옴표 안 경로("HKCU:\…")도 잡되, Write-Output "Set-ItemProperty HKCU:\x" 같은 글자는 명령 이름이 아니라 통과.
const REG_WRITE_VERBS = new Set(['set-itemproperty', 'new-itemproperty', 'remove-itemproperty', 'rename-itemproperty', 'clear-itemproperty',
  'set-item', 'new-item', 'remove-item', 'rename-item', 'copy-item', 'move-item', 'clear-item', 'copy-itemproperty', 'move-itemproperty',
  'sp', 'rp', 'rnp', 'clp', 'cpp', 'mp', 'si', 'ni', 'ri', 'rni', 'cpi', 'mi', 'cli', 'del', 'rm', 'erase', 'rd', 'rmdir']);
const REG_PATH_RE = /^(-[a-z]+:)?(hk(lm|cu|cr|u|cc):|registry::|microsoft\.powershell\.core\\registry::)/i;
function isRegistryWrite(s) {
  return REG_WRITE_VERBS.has(s.verb) && s.toks.slice(1).some((t) => REG_PATH_RE.test(t));
}

function gitInfo(toks) {
  if (verbOf(toks[0]) !== 'git') return null;
  let i = 1;
  while (i < toks.length && /^-/.test(toks[i])) {
    if (/^-(C|c)$/.test(toks[i]) || /^--(git-dir|work-tree|namespace|exec-path|config-env)$/.test(toks[i])) i += 2; else i += 1;
  }
  return { sub: String(toks[i] || '').toLowerCase(), args: toks.slice(i + 1) };
}

function stageInfo(stage) {
  // 스크립트 블록·묶음 괄호를 벗긴다: "& { Remove-Item … }", "{ … }", "(rd /s /q C:\)" → 속 명령. (; 로 나뉜 뒤 남은 } 조각도)
  //  끝의 } ) 는 짝이 안 맞을 때만 벗긴다 (${HOME}, $(pwd) 같은 건 그대로)
  stage = String(stage).replace(/^[\s&{(]+(?=\S)/, (m) => (/[{(]/.test(m) ? '' : m));
  const cnt = (ch) => (blankQuotes(stage).split(ch).length - 1);
  while (/[})]\s*$/.test(stage)) {
    const last = stage.trimEnd().slice(-1), open = last === '}' ? '{' : '(';
    if (cnt(last) <= cnt(open)) break;
    stage = stage.trimEnd().slice(0, -1);
  }
  stage = stage.trim();
  const toks = tokenize(stage);
  const head = toks[0] === '&' ? toks.slice(1) : toks;
  const bare = blankQuotes(stage);
  let verb = verbOf(head[0]);
  let glued = '';
  const m = String(head[0] || '').toLowerCase().match(/^(rd|rmdir|del|erase)(\/.*)$/); // rd/s/q → rd + /s/q
  if (m) { verb = m[1]; glued = m[2]; }
  return { text: stage, bare, toks: head, verb, glued, git: gitInfo(head) };
}

const normUrl = (x) => String(x).replace(/[.,;:!?)\]]+$/, '').replace(/\/+$/, '').toLowerCase();
const DOWNLOAD_RE =/^(iwr|irm|invoke-webrequest|invoke-restmethod|curl|wget|start-bitstransfer|certutil|bitsadmin)$/;
const RUNNER_RE = /^(iex|invoke-expression|sh|bash|zsh|python[0-9.]*|py|node|pwsh|powershell|cmd)$/;

// 결과: null 또는 { level: 'always'|'confirm', what }
export function judge(cmd, userText, depth = 0) {
  const c = String(cmd || '');
  if (!c.trim()) return null;
  if (c.includes('\u0000ENCODED')) return CONFIRM_ENCODED(userText);
  const u = String(userText || '');
  const downloaded = new Set();
  let confirmHit = null;
  for (const stmt of splitCommand(c)) {
    const infos = stmt.map(stageInfo);
    if (/win32_shadowcopy/i.test(stmt.join(' ')) && infos.some((p) => /^(remove-ciminstance|remove-wmiobject)$/.test(p.verb))) {
      return { level: 'always', what: '복원 지점(섀도 복사본) 삭제' };
    }
    for (let i = 0; i < infos.length; i++) {
      const s = infos[i];
      // 속 명령 먼저
      if (depth < MAX_DEPTH) for (const inner of innerCommands(s.text)) {
        const r = judge(inner, u, depth + 1);
        if (r && r.level === 'always') return r;
        if (r && !confirmHit) confirmHit = r;
      }
      // 1) 통째 삭제
      if (DEL_VERBS.has(s.verb) && (/\/s\b/i.test(s.glued) || s.toks.slice(1).some((t) => RECURSE_TOK.test(t))) && s.toks.slice(1).some(isRootTarget)) {
        return { level: 'always', what: '드라이브·사용자 폴더·시스템 폴더 통째 삭제' };
      }
      if (['remove-item', 'ri', 'del', 'rm', 'erase'].includes(s.verb) && s.toks.slice(1).some((t) => /^[a-z]:[\\/]?\*$|^[\\/]\*$/i.test(normPath(t)))) {
        return { level: 'always', what: '드라이브 최상위 전체 삭제' };
      }
      if (i > 0 && ['remove-item', 'ri', 'del', 'rm', 'erase', 'rd', 'rmdir'].includes(s.verb) && infos.slice(0, i).some((p) => LIST_VERBS.has(p.verb) && p.toks.slice(1).some(isRootTarget))) {
        return { level: 'always', what: '드라이브·사용자 폴더 목록을 통째로 지우는 파이프' };
      }
      if (/\[(system\.)?io\.(directory|file)\]::delete\s*\(/i.test(s.text)) {
        const mm = s.text.match(/::delete\s*\(\s*["']([^"']+)["']/i);
        if (!mm || isRootTarget(mm[1])) return { level: 'always', what: '.NET 으로 드라이브·사용자 폴더 삭제' };
      }
      if (s.verb === 'robocopy' && s.toks.some((t) => /^\/(mir|purge)$/i.test(t)) && isRootTarget(s.toks[2] || '')) {
        return { level: 'always', what: 'robocopy /MIR 로 드라이브·사용자 폴더 비우기' };
      }
      for (const [re, what] of ALWAYS) if (re.test(s.bare)) return { level: 'always', what };

      // 2) 인터넷 스크립트: 받아서 바로 실행(파이프·iex), 또는 받아 둔 파일을 다음 문장에서 실행
      // 사용자가 그 주소를 "그대로" 줬을 때만 (앞부분만 같은 다른 주소는 안 됨: …/x.ps1 ≠ …/x.ps1.bak)
      const urls = s.text.match(/https?:\/\/[^\s'"|)]+/gi) || [];
      const userUrls = new Set((u.match(/https?:\/\/[^\s'"|)<>]+/gi) || []).map(normUrl));
      const urlOk = urls.length > 0 && urls.every((x) => userUrls.has(normUrl(x)));
      if (DOWNLOAD_RE.test(s.verb)) {
        const next = infos[i + 1];
        if (next && RUNNER_RE.test(next.verb) && !urlOk) confirmHit = confirmHit || { level: 'confirm', what: '인터넷에서 받은 스크립트를 바로 실행' };
        const o = s.toks.findIndex((t) => /^(-o|--output|-outfile|-out)$/i.test(t));
        if (o >= 0 && s.toks[o + 1]) downloaded.add(s.toks[o + 1].toLowerCase().replace(/^\.[\\/]/, ''));
        const gt = s.text.match(/>\s*["']?([^\s"']+)/);
        if (gt) downloaded.add(gt[1].toLowerCase().replace(/^\.[\\/]/, ''));
      }
      if (/\biex\b|invoke-expression/i.test(s.bare) && /\b(iwr|irm|invoke-webrequest|invoke-restmethod|net\.webclient|downloadstring)\b/i.test(s.text) && !urlOk) {
        confirmHit = confirmHit || { level: 'confirm', what: '인터넷에서 받은 스크립트를 바로 실행' };
      }
      const dl = (t) => downloaded.has(String(t).toLowerCase().replace(/^\.[\\/]/, ''));
      const runsFile = (RUNNER_RE.test(s.verb) || /^(start-process|start|saps|\.)$/.test(s.verb)) && s.toks.slice(1).some(dl);
      if (downloaded.size && (runsFile || dl(s.toks[0])) && !DOWNLOAD_RE.test(s.verb)) {
        confirmHit = confirmHit || { level: 'confirm', what: '인터넷에서 받은 파일을 실행' };
      }
      for (const [test, what, ok] of CONFIRM) {
        let hit = false;
        try { hit = test(s); } catch { hit = false; }
        if (hit && !ok.test(u)) { confirmHit = confirmHit || { level: 'confirm', what }; }
      }
    }
  }
  return confirmHit;
}
function CONFIRM_ENCODED(u) {
  return /(encoded|인코딩|base64)/i.test(String(u || '')) ? null : { level: 'confirm', what: '풀 수 없는 인코딩 PowerShell 명령 실행' };
}

function decide(input) {
  if (existsSync(join(DATA_DIR, 'off'))) return { decision: 'ask' };
  try { if (JSON.parse(readFileSync(join(DATA_DIR, 'config.json'), 'utf8').replace(/^\uFEFF/, '')).dangerGuard === false) return { decision: 'ask' }; } catch {}
  const call = input.toolCall || {};
  if (call.name && call.name !== 'run_command') return { decision: 'ask' };
  const a = call.args || {};
  const cmd = a.CommandLine || a.Command || a.command || '';
  // 사용자의 이번 메시지: 훅 입력(lastUserInput)이 우선, 없으면 PreInvocation 이 기록한 것
  let userText = typeof input.lastUserInput === 'string' ? input.lastUserInput : '';
  const conv = String(input.conversationId || '');
  if (!userText && ID_RE.test(conv)) { try { userText = JSON.parse(readFileSync(join(DATA_DIR, 'state', conv + '.json'), 'utf8')).lastUserText || ''; } catch {} }
  const j = judge(cmd, String(userText).slice(0, 4000));
  if (!j) return { decision: 'ask' };
  const reason = j.level === 'always'
    ? `[위험 명령 차단] ${j.what}은(는) 되돌릴 수 없어 Antigravity Implant 가 항상 막습니다. 다른 방법을 쓰거나, 꼭 필요하면 무엇을 왜 해야 하는지 사용자에게 설명하고 사용자가 직접 실행하게 하세요.`
    : `[확인 필요] ${j.what}은(는) 되돌리기 어렵습니다. 사용자가 이번 메시지에서 시킨 일이 아니라서 막았습니다. 실행하지 말고, 무엇을 왜 하려는지 한 문장으로 설명한 뒤 사용자에게 허락을 물으세요. 사용자가 그 일을 분명히 말하면 다음 요청부터는 통과합니다.`;
  return { decision: 'deny', reason };
}

// 훅으로 실행될 때만 (시험은 judge 를 import 해서 쓴다). 경로 비교 대신 파일 이름으로 확인 — 링크·짧은 경로에서도 동작.
if (/danger_guard\.mjs$/i.test(String(process.argv[1] || ''))) {
  let out = { decision: 'ask' };
  try {
    let raw = '';
    try { raw = readFileSync(0, 'utf8'); } catch {}
    raw = raw.replace(/^\uFEFF/, '');
    out = decide(raw.trim() ? JSON.parse(raw) : {}) || { decision: 'ask' };
    if (out.decision !== 'deny') out = { decision: 'ask' }; // allow 는 절대 내지 않는다
  } catch { out = { decision: 'ask' }; }
  process.stdout.write(JSON.stringify(out).replace(/[^\x00-\x7e]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')) + '\n');
}
