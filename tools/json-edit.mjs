// 설치 스크립트용 JSON 편집 도구 (PowerShell 5.1 의 ConvertFrom/To-Json 은 배열·깊이·특수문자를 망가뜨릴 수 있어 node 로 한다).
// 사용:
//   node json-edit.mjs set-statusline <settings.json> <statusline.mjs 경로>
//   node json-edit.mjs remove-statusline <settings.json> <플러그인 이름>
//   node json-edit.mjs set-mcp <mcp_config.json> <서버 이름> <서버 JSON 파일>
// 동작: 원본을 <파일>.bak-<시각> 으로 백업(원본이 있을 때만) → 새 내용을 임시 파일에 다 쓴 뒤 바꿔 끼운다.
//       원본이 JSON 으로 읽히지 않으면(주석 등) 아무것도 바꾸지 않고 종료 코드 2.
import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [cmd, file, a, b] = process.argv.slice(2);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const fail = (msg, code = 1) => { process.stderr.write(msg + '\n'); process.exit(code); };

function load() {
  if (!existsSync(file)) return { data: {}, indent: 2, existed: false };
  const raw = readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!raw.trim()) return { data: {}, indent: 2, existed: true };
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail(`${file} 가 JSON 객체가 아니라 바꾸지 않았습니다.`, 2);
    return { data, indent: (raw.match(/\n([ \t]+)"/) || [, '  '])[1], existed: true };
  } catch (e) { fail(`${file} 를 JSON 으로 읽을 수 없어(주석이 있거나 깨짐) 바꾸지 않았습니다: ${e.message}`, 2); }
}
function save({ data, indent, existed }) {
  mkdirSync(dirname(file), { recursive: true });
  if (existed) { copyFileSync(file, `${file}.bak-${stamp}`); process.stdout.write(`백업: ${file}.bak-${stamp}\n`); }
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, indent) + '\n', 'utf8');
  renameSync(tmp, file);
}

const doc = load();
if (cmd === 'set-statusline') {
  const prev = doc.data.statusLine;
  if (prev && typeof prev === 'object' && prev.command && !/statusline\.mjs/i.test(String(prev.command))) {
    process.stdout.write(`기존 상태줄 명령을 바꿉니다 (이전: ${String(prev.command).slice(0, 120)})\n`);
  }
  doc.data.statusLine = { type: 'command', command: `node "${a}"`, enabled: true, stack_with_default: true };
  save(doc); process.stdout.write('상태줄 설정 완료\n');
} else if (cmd === 'remove-statusline') {
  const prev = doc.data.statusLine;
  if (prev && typeof prev === 'object' && new RegExp(`plugins[\\\\/]+${a}[\\\\/]`, 'i').test(String(prev.command || ''))) {
    delete doc.data.statusLine; save(doc); process.stdout.write('상태줄 설정을 지웠습니다\n');
  } else process.stdout.write('이 플러그인의 상태줄 설정이 없어 그대로 둡니다\n');
} else if (cmd === 'set-mcp') {
  let server;
  try { server = JSON.parse(readFileSync(b, 'utf8')); } catch (e) { fail('서버 설정을 읽지 못했습니다: ' + e.message); }
  const servers = (doc.data.mcpServers && typeof doc.data.mcpServers === 'object') ? doc.data.mcpServers : (doc.data.mcpServers = {});
  if (servers[a]) process.stdout.write(`기존 "${a}" 서버 설정을 바꿉니다\n`);
  servers[a] = server;
  save(doc); process.stdout.write(`MCP 서버 "${a}" 등록 완료\n`);
} else fail('사용: node json-edit.mjs set-statusline|remove-statusline|set-mcp …');
