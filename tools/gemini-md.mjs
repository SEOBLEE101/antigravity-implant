// GEMINI.md 에 "읽기 쉬운 답" 규칙 구역을 안전하게 추가·갱신·제거하는 CLI 도구.
// 사용:
//   node gemini-md.mjs set <gemini.md> [--lang <auto|tag>] [--locale <tag>] [--app-config <path>] [--implant-config <path>] [--force]
//   node gemini-md.mjs remove <gemini.md>
//   node gemini-md.mjs status <gemini.md> [--json]
// 동작: 실제 변경이 있고 원본이 존재할 때만 <파일>.bak-<시각> 으로 백업 → 임시 파일에 쓴 뒤 원자적으로 교체.
//       깨진 마커가 감지되면 아무것도 바꾸지 않고 종료 코드 2. 잘못된 인자면 종료 코드 1.

import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  detectLanguage,
  renderReadableReplies,
  parseInstalledMarker,
  hasManualReadableSection,
  upsertReadableBlock,
  removeReadableBlock,
} from './readable-replies.mjs';

function fail(msg, code = 1) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

function parseArgs(argv) {
  const [cmd, file, ...rest] = argv;
  const flags = {
    lang: undefined,
    locale: undefined,
    appConfig: undefined,
    implantConfig: undefined,
    force: false,
    json: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const nextVal = () => {
      if (i + 1 >= rest.length) fail(`옵션 값이 빠졌습니다: ${a}`, 1);
      return rest[++i];
    };
    if (a === '--lang') flags.lang = nextVal();
    else if (a.startsWith('--lang=')) flags.lang = a.slice(7);
    else if (a === '--locale') flags.locale = nextVal();
    else if (a.startsWith('--locale=')) flags.locale = a.slice(9);
    else if (a === '--app-config') flags.appConfig = nextVal();
    else if (a.startsWith('--app-config=')) flags.appConfig = a.slice(13);
    else if (a === '--implant-config') flags.implantConfig = nextVal();
    else if (a.startsWith('--implant-config=')) flags.implantConfig = a.slice(17);
    else if (a === '--force') flags.force = true;
    else if (a === '--json') flags.json = true;
    else fail(`알 수 없는 옵션입니다: ${a}`, 1);
  }
  return { cmd, file, flags };
}

function readJsonSafe(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
    if (!raw.trim()) return null;
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

function loadMarkdown(file) {
  if (!existsSync(file)) return { existed: false, hasBom: false, body: '' };
  const raw = readFileSync(file, 'utf8');
  const hasBom = raw.startsWith('\uFEFF');
  return { existed: true, hasBom, body: hasBom ? raw.slice(1) : raw };
}

function makeBackupPath(file) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  let cand = `${file}.bak-${stamp}`;
  for (let n = 1; existsSync(cand); n++) cand = `${file}.bak-${stamp}-${n}`;
  return cand;
}

function saveAtomic(file, nextBody, { existed, hasBom }) {
  mkdirSync(dirname(file), { recursive: true });
  if (existed) {
    const bak = makeBackupPath(file);
    copyFileSync(file, bak);
    process.stdout.write(`백업: ${bak}\n`);
  }
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const content = (hasBom ? '\uFEFF' : '') + nextBody;
  writeFileSync(tmp, content, 'utf8');
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (e) {
      if (i >= 5 || !/EPERM|EACCES|EBUSY/.test(String(e.code))) {
        try { rmSync(tmp, { force: true }); } catch {}
        throw e;
      }
      const until = Date.now() + 30 * (i + 1);
      while (Date.now() < until) { /* Windows 파일 잠금 짧게 대기 */ }
    }
  }
}

const { cmd, file, flags } = parseArgs(process.argv.slice(2));
if (!cmd || !file || !['set', 'remove', 'status'].includes(cmd)) {
  fail('사용: node gemini-md.mjs set|remove|status <gemini.md> [옵션]', 1);
}

const doc = loadMarkdown(file);

if (cmd === 'status') {
  const parsed = parseInstalledMarker(doc.body);
  const manualSection = hasManualReadableSection(doc.body);
  const info = {
    file,
    exists: doc.existed,
    ok: parsed.ok,
    present: Boolean(parsed.present),
    lang: parsed.lang || null,
    manualSection,
    ...(parsed.error ? { error: parsed.error } : {}),
  };
  if (flags.json) {
    process.stdout.write(JSON.stringify(info) + '\n');
  } else if (!doc.existed) {
    process.stdout.write(`GEMINI.md 없음 (${file})\n`);
  } else if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n`);
  } else if (parsed.present) {
    process.stdout.write(`읽기 쉬운 답 규칙 적용됨 (언어: ${parsed.lang})\n`);
  } else if (manualSection) {
    process.stdout.write('수동 작성된 읽기 쉬운 답 규칙 있음 (플러그인 마커 없음)\n');
  } else {
    process.stdout.write('읽기 쉬운 답 규칙 미적용\n');
  }
  if (!parsed.ok) process.exit(2);
  process.exit(0);
}

if (cmd === 'remove') {
  if (!doc.existed) {
    process.stdout.write('GEMINI.md 가 없어 그대로 둡니다\n');
    process.exit(0);
  }
  const res = removeReadableBlock(doc.body);
  if (res.status === 'broken') fail(res.error, 2);
  if (res.status === 'absent') {
    process.stdout.write('읽기 쉬운 답 마커가 없어 그대로 둡니다\n');
    process.exit(0);
  }
  saveAtomic(file, res.text, doc);
  process.stdout.write(`읽기 쉬운 답 규칙을 제거했습니다 (언어: ${res.lang})\n`);
  process.exit(0);
}

if (cmd === 'set') {
  const appConfig = readJsonSafe(flags.appConfig);
  const implantConfig = readJsonSafe(flags.implantConfig);
  const detected = detectLanguage({
    cliLang: flags.lang,
    implantConfig,
    appConfig,
    existingMarkdown: doc.body,
    env: process.env,
    osLocale: flags.locale,
  });
  if (detected.error) fail(detected.error, 1);

  const rendered = renderReadableReplies(detected.tag);
  const res = upsertReadableBlock(doc.body, rendered.block, { force: flags.force });
  if (res.status === 'broken') fail(res.error, 2);
  if (res.status === 'skipped-manual') {
    process.stdout.write("이미 수동으로 작성된 '읽기 쉬운 답' 규칙이 있어 건너뜁니다. 플러그인 관리로 전환하려면 기존 구역을 지우거나 --force 를 사용하세요.\n");
    process.exit(0);
  }

  const fallbackNote = rendered.fallback ? ` — 미지원 로캘 폴백(영어 규칙 + ${rendered.requestedTag} 응답 지시)` : '';
  if (res.status === 'unchanged') {
    process.stdout.write(`읽기 쉬운 답 규칙이 이미 최신입니다 (언어: ${rendered.lang}, 출처: ${detected.source}${fallbackNote})\n`);
    process.exit(0);
  }

  saveAtomic(file, res.text, doc);
  const actionLabel = res.status === 'added' ? (doc.existed ? '추가' : '생성') : '갱신';
  process.stdout.write(`읽기 쉬운 답 규칙 ${actionLabel} 완료 (언어: ${rendered.lang}, 출처: ${detected.source}${fallbackNote})\n`);
  process.exit(0);
}
