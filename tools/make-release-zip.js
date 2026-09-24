#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 构建发布 zip（供 GitHub Release 使用，也可本地跑）
//
//   node tools/make-release-zip.js [输出路径]     # 默认 dist/star-rail-analysis.zip
//
// 内容 = git HEAD 的全部跟踪文件（自动应用 .gitattributes 的行尾规则，
// 也就是说 start.bat 在 zip 里是 CRLF）+ 一个空的 data/ 目录。
// 排除 .github/（运行时用不上）。
//
// 刻意**不**打包游戏图标（assets/avatar 等）：它们不入库（版权），
// 服务端首次启动会自动下载（约 5 MB），这样发布流水线不依赖外网 CDN。
//
// 依赖：git / tar / zip（macOS 与 ubuntu-latest 都自带）。
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STAGED = process.argv.includes('--staged');
const argPath = process.argv.slice(2).find(a => !a.startsWith('--'));
const OUT = path.resolve(argPath || path.join(ROOT, 'dist', 'star-rail-analysis.zip'));
const DIRNAME = 'star-rail-analysis';   // zip 解压后的顶层目录名（固定，方便引用）

function die(msg) { console.error('✗ ' + msg); process.exit(1); }
function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts));
  if (r.status !== 0) die(cmd + ' ' + args.join(' ') + ' 失败：\n' + (r.stdout || '') + (r.stderr || ''));
  return r.stdout || '';
}

// ── 前置检查 ──
for (const c of ['git', 'tar', 'zip']) {
  const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
  if (r.error) die('缺少命令行工具：' + c + '（macOS / Linux 一般自带）');
}
// 打包对象：默认 HEAD；传 --staged 则打包「暂存区」的树（提交前自测用，
// 需先 git add——注意 dist/ 已在 .gitignore 里，不会被卷进来）
const TREE = STAGED ? run('git', ['write-tree'], { cwd: ROOT }).trim() : 'HEAD';
run('git', ['rev-parse', '--verify', TREE + '^{tree}'], { cwd: ROOT });   // 确认树存在

// ── 暂存目录 ──
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sra-dist-'));
const inner = path.join(stage, DIRNAME);
fs.mkdirSync(inner, { recursive: true });

// ① 全部跟踪文件（tar 中转会应用 .gitattributes 的 eol 规则）
run('bash', ['-c',
  'git -C ' + JSON.stringify(ROOT) + ' archive ' + TREE + ' -- ":(exclude).github" | tar -x -C ' + JSON.stringify(inner)
]);

// ② 运行时产物一律不带
for (const j of ['.port', '.server.log']) {
  try { fs.unlinkSync(path.join(inner, j)); } catch (e) {}
}

// ③ 空的 data/（一个 .gitkeep 占位，保持目录结构）
fs.mkdirSync(path.join(inner, 'data'), { recursive: true });
fs.writeFileSync(path.join(inner, 'data', '.gitkeep'), '');

// ── 打包 ──
fs.mkdirSync(path.dirname(OUT), { recursive: true });
// 先在暂存目录旁边打包，再用 Node 拷到目标（避免 zip 二进制直写任意路径）
const tmpZip = path.join(stage, '..', 'sra-' + path.basename(OUT));
run('zip', ['-r', '-q', '-X', path.join('..', path.basename(tmpZip)), DIRNAME], { cwd: stage });
fs.copyFileSync(tmpZip, OUT);
try { fs.unlinkSync(tmpZip); } catch (e) {}

// ── 汇报 ──
const count = run('unzip', ['-l', OUT])
  .split('\n').filter(l => / star-rail-analysis\//.test(l) && !/\/$/.test(l)).length;
const size = fs.statSync(OUT).size;
console.log('✔ ' + OUT);
console.log('  ' + count + ' 个文件 · ' + (size / 1024 / 1024).toFixed(2) + ' MB · 顶层目录 ' + DIRNAME + '/');

// 清理暂存
fs.rmSync(stage, { recursive: true, force: true });
