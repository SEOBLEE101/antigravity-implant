// GEMINI.md "읽기 쉬운 답" 규칙 번역·언어 감지·CLI·install.ps1 정적 검사 시험.
// 주의: 실제 ~/.gemini 를 건드리지 않고 임시 폴더에서만 실행한다. install.ps1 은 실행하지 않고 AST 만 검사한다.
// 실행: node tests/gemini-md-test.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUPPORTED_LANGS,
  TRANSLATIONS,
  normalizeLangTag,
  resolveBuiltinLang,
  detectLanguage,
  renderReadableReplies,
  parseInstalledMarker,
  hasManualReadableSection,
  upsertReadableBlock,
  removeReadableBlock,
} from '../tools/readable-replies.mjs';

const testsDir = dirname(fileURLToPath(import.meta.url));
const pluginRepo = join(testsDir, '..');
const geminiMdCli = join(pluginRepo, 'tools', 'gemini-md.mjs');
const doctorCli = join(pluginRepo, 'antigravity-implant', 'cli', 'doctor.mjs');
const installPs1 = join(pluginRepo, 'install.ps1');

const tmp = mkdtempSync(join(tmpdir(), 'agyc-geminimd-'));
let fails = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '\n      ' + detail}`);
  if (!cond) fails++;
};

function runCli(args, envExtra = {}) {
  return spawnSync(process.execPath, [geminiMdCli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...envExtra },
  });
}

try {
  // 1) 9개 내장 언어 번역 및 한국어 원문 10항목 검증
  check('지원 언어 9개 정의됨', SUPPORTED_LANGS.length === 9, SUPPORTED_LANGS.join(','));
  for (const lang of SUPPORTED_LANGS) {
    const r = renderReadableReplies(lang);
    const hasHeading = r.block.includes(TRANSLATIONS[lang].heading);
    const hasAll10 = Array.from({ length: 10 }, (_, i) => r.block.includes(`\n${i + 1}. `)).every(Boolean);
    const hasMarkers = r.block.startsWith(`<!-- antigravity-implant:readable-replies:start lang=${lang} -->`) &&
      r.block.endsWith('<!-- antigravity-implant:readable-replies:end -->');
    check(`내장 번역 렌더링 (${lang})`, !r.fallback && hasHeading && hasAll10 && hasMarkers, r.block.slice(0, 200));
  }

  const koRendered = renderReadableReplies('ko').block;
  const koExpectedFragments = [
    '## 읽기 쉬운 답',
    '1. 결론부터. 첫 문단 한두 문장에 답이나 결과를 쓰고, 설명은 그 뒤에 둔다.',
    '4. 코드 서식(`)은 사용자가 그대로 복사해 입력할 것에만 쓴다: 명령, 코드, 파일 경로, 설정 값, 단축키.',
    '5. 파일은 문장 중간에 넣지 않는다. 문장에서는 "상세 학습 계획 파일"처럼 무엇인지 말로 쓰고, 파일 이름·링크는 그 줄이나 문단 끝에 "파일: 이름1, 이름2"로 한 번에 모은다.',
    '10. 끝은 사용자가 다음에 할 일이나 결정할 것 하나로 맺는다. 같은 내용을 마지막에 다시 요약하지 않는다.',
  ];
  check('한국어 원문 10항목 보존', koExpectedFragments.every((s) => koRendered.includes(s)));

  // 2) 미지원 로캘 폴백 + 태그 정규화
  check('로캘 정규화 (POSIX/공백/대소문자)',
    normalizeLangTag('ko_KR.UTF-8') === 'ko-KR' &&
    normalizeLangTag('zh_hant_tw') === 'zh-Hant-TW' &&
    normalizeLangTag('C.UTF-8') === null &&
    normalizeLangTag('POSIX') === null &&
    normalizeLangTag('ko-->') === null &&
    normalizeLangTag('AUTO') === 'auto'
  );
  check('지역 태그 → 내장 언어 매핑',
    resolveBuiltinLang('ko-KR') === 'ko' &&
    resolveBuiltinLang('en-GB') === 'en' &&
    resolveBuiltinLang('ja-JP') === 'ja' &&
    resolveBuiltinLang('zh-HK') === 'zh-TW' &&
    resolveBuiltinLang('zh-Hant') === 'zh-TW' &&
    resolveBuiltinLang('zh-SG') === 'zh-CN' &&
    resolveBuiltinLang('zh-Hans-CN') === 'zh-CN' &&
    resolveBuiltinLang('vi-VN') === null
  );

  const viRes = renderReadableReplies('vi-VN');
  check('미지원 로캘(vi-VN) 영어 폴백 + 언어 지시',
    viRes.fallback === true &&
    viRes.lang === 'vi-VN' &&
    viRes.block.includes('<!-- antigravity-implant:readable-replies:start lang=vi-VN -->') &&
    viRes.block.includes("Write replies in the user's language (vi-VN) while following these rules.") &&
    viRes.block.includes('1. Start with the conclusion.'),
    viRes.block.slice(0, 300)
  );

  // 3) 언어 감지 우선순위 전 단계
  {
    const baseOpts = {
      cliLang: 'auto',
      implantConfig: { language: 'ja' },
      appConfig: { userSettings: { language: 'fr' } },
      existingMarkdown: '항상 한국어로 대답한다. 이 프로젝트는 테스트용입니다.',
      env: { ANTIGRAVITY_LANG: 'de', LC_ALL: 'es_ES.UTF-8', LANG: 'pt_BR.UTF-8' },
      osLocale: 'zh-TW',
      intlLocale: 'zh-CN',
    };
    check('감지 우선순위 1: --lang 최우선',
      detectLanguage({ ...baseOpts, cliLang: 'pt-BR' }).builtin === 'pt' &&
      detectLanguage({ ...baseOpts, cliLang: 'pt-BR' }).source === 'cli'
    );
    check('감지 우선순위 2: implant config.json',
      detectLanguage(baseOpts).builtin === 'ja' &&
      detectLanguage(baseOpts).source === 'implant-config'
    );
    check('감지 우선순위 3: 앱 config.json userSettings',
      detectLanguage({ ...baseOpts, implantConfig: { language: 'auto' } }).builtin === 'fr' &&
      detectLanguage({ ...baseOpts, implantConfig: { language: 'auto' } }).source === 'app-config'
    );
    check('감지 우선순위 4: GEMINI.md 본문(한국어)',
      detectLanguage({ ...baseOpts, implantConfig: null, appConfig: null }).builtin === 'ko' &&
      detectLanguage({ ...baseOpts, implantConfig: null, appConfig: null }).source === 'gemini-md'
    );
    check('감지 우선순위 4b: GEMINI.md 명시 지시(한국어 문서 내 영어로 대답)',
      detectLanguage({
        existingMarkdown: '이 프로젝트의 모든 안내와 코드는 한국어로 정리한다. 하지만 사용자에게는 항상 영어로 대답한다.',
        env: {}, osLocale: '', intlLocale: '',
      }).builtin === 'en'
    );
    check('감지 우선순위 4c: GEMINI.md 분포(일본어/간체/번체/영어)',
      detectLanguage({ existingMarkdown: '常に日本語で簡潔かつ正確に回答してください。コードは変更しないでください。', env: {}, osLocale: '', intlLocale: '' }).builtin === 'ja' &&
      detectLanguage({ existingMarkdown: '请始终使用简体中文回答问题，并保持代码和文件路径的准确说明与验证步骤。', env: {}, osLocale: '', intlLocale: '' }).builtin === 'zh-CN' &&
      detectLanguage({ existingMarkdown: '請始終使用繁體中文回答問題，並保持程式碼與檔案路徑的準確說明與驗證步驟。', env: {}, osLocale: '', intlLocale: '' }).builtin === 'zh-TW' &&
      detectLanguage({ existingMarkdown: 'Always verify the files and write clear tests for your changes before finishing the task and explaining the results.', env: {}, osLocale: '', intlLocale: '' }).builtin === 'en'
    );
    check('감지 우선순위 5: ANTIGRAVITY_LANG 환경변수',
      detectLanguage({ ...baseOpts, implantConfig: null, appConfig: null, existingMarkdown: '' }).builtin === 'de' &&
      detectLanguage({ ...baseOpts, implantConfig: null, appConfig: null, existingMarkdown: '' }).source === 'env:ANTIGRAVITY_LANG'
    );
    check('감지 우선순위 6: OS 로캘(--locale)',
      detectLanguage({ ...baseOpts, implantConfig: null, appConfig: null, existingMarkdown: '', env: { LC_ALL: 'es_ES.UTF-8' } }).builtin === 'zh-TW' &&
      detectLanguage({ ...baseOpts, implantConfig: null, appConfig: null, existingMarkdown: '', env: { LC_ALL: 'es_ES.UTF-8' } }).source === 'os-locale'
    );
    check('감지 우선순위 7: LANG / LC_ALL (.UTF-8 정리, C/POSIX 무시)',
      detectLanguage({ env: { LC_ALL: 'C.UTF-8', LANG: 'es_ES.UTF-8' }, osLocale: '', intlLocale: '' }).builtin === 'es' &&
      detectLanguage({ env: { LC_ALL: 'POSIX', LANG: 'C' }, osLocale: '', intlLocale: 'fr-FR' }).builtin === 'fr'
    );
    check('감지 우선순위 9: 기본값 en',
      detectLanguage({ env: { LANG: 'C' }, osLocale: '', intlLocale: '' }).builtin === 'en' &&
      detectLanguage({ env: { LANG: 'C' }, osLocale: '', intlLocale: '' }).source === 'default'
    );

    // 이전 마커 블록의 언어가 자동 감지를 오염시키지 않는지 검증
    const prevEnBlock = renderReadableReplies('en').block;
    const mixedMd = '# 내 프로젝트 규칙\n모든 작업은 한국어로 친절하게 설명하고 안전 규칙을 반드시 지킨다.\n\n' + prevEnBlock + '\n';
    const reDetected = detectLanguage({ existingMarkdown: mixedMd, env: {}, osLocale: '', intlLocale: 'en-US' });
    check('이전 영어 마커가 남아도 본문이 한국어면 ko 감지',
      reDetected.builtin === 'ko' && reDetected.source === 'gemini-md',
      JSON.stringify(reDetected)
    );
  }

  // 4) CLI 통합 테스트 (파일 생성·백업·CRLF/BOM·멱등성·언어전환·수동중복·제거·깨진마커)
  {
    const dir = join(tmp, 'cli');
    mkdirSync(dir, { recursive: true });

    // 4-1) 신규 생성 (백업 미생성)
    const freshMd = join(dir, 'fresh-GEMINI.md');
    const rFresh = runCli(['set', freshMd, '--lang', 'ko']);
    const bakFresh = readdirSync(dir).filter((n) => n.startsWith('fresh-GEMINI.md.bak-'));
    check('CLI 신규 생성 (종료 0, 백업 없음, UTF-8 BOM 없음)',
      rFresh.status === 0 &&
      existsSync(freshMd) &&
      bakFresh.length === 0 &&
      !readFileSync(freshMd).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) &&
      readFileSync(freshMd, 'utf8').includes('## 읽기 쉬운 답'),
      rFresh.stderr || rFresh.stdout
    );

    // 4-2) 기존 파일(BOM + CRLF) 병합 및 백업
    const crlfMd = join(dir, 'crlf-GEMINI.md');
    const origCrlf = '\uFEFF# 개인 규칙\r\n기존 사용자 규칙을 그대로 유지해야 합니다.\r\n';
    writeFileSync(crlfMd, origCrlf, 'utf8');
    const rMerge = runCli(['set', crlfMd, '--lang', 'auto', '--locale', 'en-US'], { ANTIGRAVITY_LANG: '', LC_ALL: '', LANG: '' });
    const afterMergeBuf = readFileSync(crlfMd);
    const afterMerge = afterMergeBuf.toString('utf8');
    const bakMerge = readdirSync(dir).filter((n) => n.startsWith('crlf-GEMINI.md.bak-'));
    check('CLI 기존 파일 병합 (본문 한글 감지 → ko, 백업 생성, BOM·CRLF 보존)',
      rMerge.status === 0 &&
      bakMerge.length === 1 &&
      afterMergeBuf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) &&
      afterMerge.includes('# 개인 규칙\r\n기존 사용자 규칙을 그대로 유지해야 합니다.\r\n\r\n<!-- antigravity-implant:readable-replies:start lang=ko -->\r\n') &&
      !afterMerge.replace(/\r\n/g, '').includes('\n'),
      rMerge.stdout + ' | ' + rMerge.stderr
    );

    // 4-3) 멱등성 (동일 재실행 시 파일·백업 변화 없음)
    const rIdem = runCli(['set', crlfMd, '--lang', 'ko']);
    const bakAfterIdem = readdirSync(dir).filter((n) => n.startsWith('crlf-GEMINI.md.bak-'));
    check('CLI 멱등성 (동일 실행 시 백업 추가 안 됨)',
      rIdem.status === 0 && bakAfterIdem.length === 1 && readFileSync(crlfMd, 'utf8') === afterMerge
    );

    // 4-4) 언어 전환 (ko → en → ja) 시 제자리 교체
    const rEn = runCli(['set', crlfMd, '--lang', 'en']);
    const rJa = runCli(['set', crlfMd, '--lang', 'ja']);
    const afterJa = readFileSync(crlfMd, 'utf8');
    check('CLI 언어 전환 (ko → en → ja 제자리 교체, 기존 내용 보존)',
      rEn.status === 0 && rJa.status === 0 &&
      afterJa.includes('기존 사용자 규칙을 그대로 유지해야 합니다.') &&
      afterJa.includes('<!-- antigravity-implant:readable-replies:start lang=ja -->') &&
      afterJa.includes('## 読みやすい回答') &&
      !afterJa.includes('## 읽기 쉬운 답') &&
      !afterJa.includes('## Readable Replies')
    );

    // 4-5) remove 시 마커 구역만 제거하고 원문·BOM·CRLF 보존
    const rRem = runCli(['remove', crlfMd]);
    const afterRem = readFileSync(crlfMd, 'utf8');
    const rRemAgain = runCli(['remove', crlfMd]);
    check('CLI remove (마커 구역만 제거, 원문·BOM 복원, 재실행 시 무변경)',
      rRem.status === 0 && rRemAgain.status === 0 && afterRem === origCrlf,
      JSON.stringify({ expected: origCrlf, actual: afterRem })
    );

    // 4-6) 수동 작성된 섹션 감지 시 중복 삽입 방지 및 --force 동작
    const manualMd = join(dir, 'manual-GEMINI.md');
    const manualBody = '# My Rules\n\n## Readable Replies\n1. Already written by user.\n';
    writeFileSync(manualMd, manualBody, 'utf8');
    const rSkip = runCli(['set', manualMd, '--lang', 'en']);
    const skippedUntouched = readFileSync(manualMd, 'utf8') === manualBody;
    const rForce = runCli(['set', manualMd, '--lang', 'en', '--force']);
    const forcedBody = readFileSync(manualMd, 'utf8');
    check('CLI 수동 섹션 중복 방지 (기본 건너뜀, --force 시 추가)',
      rSkip.status === 0 && skippedUntouched &&
      rForce.status === 0 && forcedBody.includes('<!-- antigravity-implant:readable-replies:start lang=en -->')
    );

    // 4-7) 깨진 마커(시작만/끝만/역순/중복) 시 exit 2 + 파일 무변경
    const brokenCases = [
      ['시작만 있음', 'abc\n<!-- antigravity-implant:readable-replies:start lang=ko -->\nhello\n'],
      ['끝만 있음', 'abc\n<!-- antigravity-implant:readable-replies:end -->\n'],
      ['역순 마커', '<!-- antigravity-implant:readable-replies:end -->\n<!-- antigravity-implant:readable-replies:start lang=ko -->\n'],
      ['중복 마커', renderReadableReplies('ko').block + '\n' + renderReadableReplies('en').block],
    ];
    let allBrokenOk = true;
    for (const [label, content] of brokenCases) {
      const bf = join(dir, `broken-${brokenCases.indexOf(brokenCases.find((x) => x[0] === label))}.md`);
      writeFileSync(bf, content, 'utf8');
      const rSet = runCli(['set', bf, '--lang', 'ko']);
      const rRm = runCli(['remove', bf]);
      const rSt = runCli(['status', bf, '--json']);
      if (rSet.status !== 2 || rRm.status !== 2 || rSt.status !== 2 || readFileSync(bf, 'utf8') !== content) {
        allBrokenOk = false;
        check(`깨진 마커 차단 (${label})`, false, `set=${rSet.status} rm=${rRm.status} st=${rSt.status}`);
      }
    }
    if (allBrokenOk) check('깨진 마커 4종 모두 exit 2 및 파일 무변경', true);

    // 4-8) 잘못된 --lang 태그 시 exit 1 + 파일 무변경
    const rBadLang = runCli(['set', freshMd, '--lang', 'ko-->bad']);
    check('잘못된 --lang 차단 (exit 1, 파일 무변경)',
      rBadLang.status === 1 && readFileSync(freshMd, 'utf8').includes('## 읽기 쉬운 답')
    );

    // 4-9) status --json 검증
    const rStatus = runCli(['status', freshMd, '--json']);
    let statusObj = {};
    try { statusObj = JSON.parse(rStatus.stdout); } catch {}
    check('CLI status --json 출력',
      rStatus.status === 0 && statusObj.ok === true && statusObj.present === true && statusObj.lang === 'ko',
      rStatus.stdout
    );

    // 4-10) appConfig / implantConfig 파일 경유 연동
    const cfgApp = join(dir, 'app-config.json');
    const cfgImp = join(dir, 'implant-config.json');
    const cfgMd = join(dir, 'cfg-GEMINI.md');
    writeFileSync(cfgApp, JSON.stringify({ userSettings: { language: 'es-MX' } }), 'utf8');
    writeFileSync(cfgImp, JSON.stringify({ language: 'auto' }), 'utf8');
    const rCfg1 = runCli(['set', cfgMd, '--app-config', cfgApp, '--implant-config', cfgImp]);
    writeFileSync(cfgImp, JSON.stringify({ language: 'pt-BR' }), 'utf8');
    const rCfg2 = runCli(['set', cfgMd, '--app-config', cfgApp, '--implant-config', cfgImp]);
    check('CLI app-config → implant-config 우선순위 연동',
      rCfg1.status === 0 && rCfg2.status === 0 &&
      readFileSync(cfgMd, 'utf8').includes('<!-- antigravity-implant:readable-replies:start lang=pt -->')
    );
  }

  // 5) doctor.mjs 가짜 홈 연동 확인
  {
    const docHome = join(tmp, 'doctor-home');
    mkdirSync(join(docHome, '.gemini'), { recursive: true });
    writeFileSync(join(docHome, '.gemini', 'GEMINI.md'), renderReadableReplies('ja').block + '\n', 'utf8');
    const dr = spawnSync(process.execPath, [doctorCli, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, USERPROFILE: docHome, HOME: docHome },
    });
    let dj = {};
    try { dj = JSON.parse(dr.stdout); } catch {}
    const hit = (dj.results || []).find((x) => x.area === '규칙' && /읽기 쉬운 답 규칙 적용됨 \(언어: ja\)/.test(x.msg));
    check('doctor.mjs GEMINI.md 읽기 쉬운 답 상태 보고', dr.status === 0 && Boolean(hit), dr.stdout.slice(0, 300));
  }

  // 6) install.ps1 UTF-8 BOM 및 PowerShell AST 정적 파싱 검증 (절대 실행하지 않음)
  {
    const psBytes = readFileSync(installPs1);
    const hasBom = psBytes[0] === 0xef && psBytes[1] === 0xbb && psBytes[2] === 0xbf;
    check('install.ps1 UTF-8 BOM 유지', hasBom);

    const psCheckCmd =
      "$e=$null;$t=$null;" +
      `$ast=[System.Management.Automation.Language.Parser]::ParseFile('${installPs1.replace(/'/g, "''")}',[ref]$t,[ref]$e);` +
      "$names=@($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath });" +
      "Write-Output ('ERR:' + @($e).Count + ';PARAMS:' + ($names -join ','))";
    const psExe = spawnSync('powershell.exe', ['-NoProfile', '-Command', psCheckCmd], { encoding: 'utf8' });
    const out = (psExe.stdout || '').trim();
    check('install.ps1 PowerShell 정적 파싱 오류 0건 및 파라미터 정의',
      psExe.status === 0 && /^ERR:0;/.test(out) && out.includes('ReadableReplies') && out.includes('Lang'),
      out || psExe.stderr
    );
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n결과: 실패 ${fails}개`);
if (fails) process.exit(1);
