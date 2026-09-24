#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// CI / 本地共用的「空数据启动冒烟」：
// 把 git HEAD（或 --staged 暂存区）导到临时目录 → 起服务 → 逐个探关键端点 → 收尾。
//
//   node tools/ci-smoke.js [--staged]
//
// 全程离线友好：不碰真实 data/、不调 /api/banner（那个要外网）。
// 图标在后台异步下载，不会阻塞端点响应（即便下载失败也不影响本测试）。
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STAGED = process.argv.includes('--staged');

function die(msg) { console.error('✗ ' + msg); process.exit(1); }
function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts));
  if (r.status !== 0) die(cmd + ' 失败：' + (r.stderr || r.stdout || ''));
  return r.stdout || '';
}

// ── 导出干净副本 ──
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sra-smoke-'));
const TREE = STAGED ? run('git', ['write-tree'], { cwd: ROOT }).trim() : 'HEAD';
run('bash', ['-c',
  'git -C ' + JSON.stringify(ROOT) + ' archive ' + TREE + ' | tar -x -C ' + JSON.stringify(stage)
]);
fs.mkdirSync(path.join(stage, 'data'), { recursive: true });

// ── 起服务 ──
const srv = spawn(process.execPath, [path.join(stage, 'server', 'server.js')],
  { cwd: stage, stdio: ['ignore', 'pipe', 'pipe'] });
let srvOut = '';
srv.stdout.on('data', d => { srvOut += d; });
srv.stderr.on('data', d => { srvOut += d; });

function ping(port, p) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 8000 },
      res => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
  });
}

(async () => {
  // 等 .port（最多 15 秒）
  const portfile = path.join(stage, '.port');
  let port = 0;
  for (let i = 0; i < 60 && !port; i++) {
    if (srv.exitCode !== null) die('服务提前退出：\n' + srvOut);
    try { port = Number(fs.readFileSync(portfile, 'utf8').replace(/\D/g, '')) || 0; } catch (e) {}
    if (!port) await new Promise(r => setTimeout(r, 250));
  }
  if (!port) { srv.kill('SIGKILL'); die('15 秒内服务没就绪：\n' + srvOut); }

  // 端点冒烟
  const endpoints = ['/', '/api/status', '/api/analysis', '/api/meta',
    '/api/divination', '/api/zeri', '/theme.css', '/assets/logo.png'];
  let failed = 0;
  for (const p of endpoints) {
    const code = await ping(port, p);
    const ok = code === 200;
    console.log((ok ? '  ✔ ' : '  ✗ ') + p + ' -> ' + code);
    if (!ok) failed++;
  }

  try { srv.kill('SIGKILL'); } catch (e) {}
  fs.rmSync(stage, { recursive: true, force: true });

  if (failed) die(failed + ' 个端点未返回 200');
  console.log('✔ 冒烟通过（' + endpoints.length + ' 个端点，空数据，端口 ' + port + '）');
  process.exit(0);
})().catch(e => { try { srv.kill('SIGKILL'); } catch (x) {} die(String(e && e.stack || e)); });
