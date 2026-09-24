#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 崩铁抽卡分析平台 · 跨平台启动器
//
// 这是启动逻辑的**唯一实现**：start.command（macOS/Linux）与 start.bat（Windows）
// 都只是薄壳，真正干活的在这里 —— 因为 Node 代码可以在 macOS 上完整测试，
// 而批处理/shell 不行。
//
// 流程：收掉残留实例 → 起服务 → 等服务端写出 .port（真实绑定端口）→ 开浏览器
// 前台挂着：关掉本终端窗口（或 Control-C）即停止服务。
//
// 兼容性：只用 Node 18 就有的稳定 API（fs / path / child_process / http）。
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LOG = path.join(ROOT, '.server.log');
const PORTFILE = path.join(ROOT, '.port');
const PORT_START = 8799;        // 与 server/server.js 保持一致
const PORT_END = 8811;
const IS_WIN = process.platform === 'win32';

// ── 小工具 ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function sh(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 });
    if (r.error) return '';
    return (r.stdout || '') + (r.stderr || '');
  } catch (e) { return ''; }
}

function pauseIfTTY() {
  // 失败路径下留住窗口，让用户看到错误信息（等效于 shell 版的 read -n 1）
  if (!process.stdin.isTTY) return Promise.resolve();
  return new Promise(resolve => {
    process.stdout.write('Press any key to close...');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', () => { process.stdin.setRawMode(false); resolve(); });
  });
}

// 从 records.json 读 UID（每行一条、每条都带 uid，只取第一条；不写死在代码里）
function readUid() {
  try {
    const s = fs.readFileSync(path.join(ROOT, 'data', 'records.json'), 'utf8');
    const m = s.match(/"uid"\s*:\s*"([^"]*)"/);
    return m ? m[1] : '';
  } catch (e) { return ''; }
}

// ── 残留实例识别 ────────────────────────────────────────────────────────────
// 只杀「本项目的」服务，绝不能误伤别的程序。条件：
//   macOS/Linux：① 命令行含 server/server.js  ② 工作目录 = 本目录
//   Windows    ：① 监听 8799~8811  ② 进程是 node.exe（cmdline 尽力比对）
function isOurServerUnix(pid) {
  // 判据①（lsof，在受限环境里也比 ps 稳）：工作目录必须就是本目录
  const cwdOut = sh('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const cwd = cwdOut.split('\n').filter(l => l.startsWith('n')).map(l => l.slice(1))[0] || '';
  if (!cwd || path.resolve(cwd) !== ROOT) return false;
  // 判据②：命令行里要能看到 server/server.js
  const cmd = sh('ps', ['-o', 'command=', '-p', String(pid)]).trim();
  if (cmd) return cmd.indexOf('server/server.js') >= 0;
  // ps 不可用（如受限环境对别的会话起的进程返回 EPERM）时，
  // 退回弱判据：可执行文件（txt fd）是 node 本身。cwd 已经卡死，误伤面很小。
  const txt = sh('lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn'])
    .split('\n').filter(l => l.startsWith('n')).map(l => l.slice(1))[0] || '';
  return /node(\.exe)?$/.test(txt);
}

function pidsOnPortUnix(port) {
  const out = sh('lsof', ['-ti', 'tcp:' + port, '-sTCP:LISTEN']);
  return out.split('\n').map(s => s.trim()).filter(s => /^\d+$/.test(s));
}

function pidsOnPortWin(port) {
  // netstat -ano 的输出行： TCP  127.0.0.1:8799  0.0.0.0:0  LISTENING  12345
  const out = sh('netstat', ['-ano', '-p', 'tcp']);
  const pids = new Set();
  for (const line of out.split('\n')) {
    if (line.indexOf('LISTENING') < 0) continue;
    const m = line.match(/[\s:](\d+)\s*$/);
    const local = line.trim().split(/\s+/)[1] || '';
    if (m && local.endsWith(':' + port)) pids.add(m[1]);
  }
  return [...pids];
}

function isNodeWin(pid) {
  const out = sh('tasklist', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH']);
  if (!out || out.indexOf('node.exe') < 0) return false;
  // 尽力再核一层命令行（wmic 在新系统可能被移除，失败就退回仅按进程名）
  const w = sh('wmic', ['process', 'where', 'ProcessId=' + pid, 'get', 'CommandLine']);
  if (!w) return true;                       // 查不到命令行，只确认了是 node.exe
  return w.indexOf('server') >= 0;           // 查得到就要求命令行像本项目
}

function collectStalePids() {
  const found = new Set();
  if (!IS_WIN) {
    // ① 正规路径：上次留下的端口文件
    if (fs.existsSync(PORTFILE)) {
      const old = fs.readFileSync(PORTFILE, 'utf8').replace(/\D/g, '');
      if (old) for (const pid of pidsOnPortUnix(old)) if (isOurServerUnix(pid)) found.add(pid);
    }
    // ② 兜底：端口文件丢了也扫一遍端口段（双击两次 / 被强杀都可能留下孤儿实例，
    //    两个服务同时写 data/records.json 会串记录）
    for (let p = PORT_START; p <= PORT_END; p++) {
      for (const pid of pidsOnPortUnix(p)) if (isOurServerUnix(pid)) found.add(pid);
    }
  } else {
    for (let p = PORT_START; p <= PORT_END; p++) {
      for (const pid of pidsOnPortWin(p)) if (isNodeWin(pid)) found.add(pid);
    }
  }
  return [...found];
}

function killPid(pid) {
  if (IS_WIN) sh('taskkill', ['/F', '/PID', String(pid)]);
  else { try { process.kill(Number(pid), 'SIGKILL'); } catch (e) {} }
}

// ── 开浏览器 ────────────────────────────────────────────────────────────────
function openBrowser(url) {
  if (IS_WIN) spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
  else if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore' }).unref();
  else spawn('xdg-open', [url], { stdio: 'ignore' }).on('error', () => {}).unref();
}

// 服务就绪后补一次健康检查（避免 .port 刚写完连接还没放行）
function ping(port) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/status', timeout: 4000 },
      res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  const uid = readUid();
  console.log('════════════════════════════════════════');
  console.log('  崩铁抽卡分析平台 / Star Rail Warp Analyzer');
  console.log('  UID ' + (uid || '尚未导入 / no data yet') + ' · 本地运行，数据不出本机');
  console.log('════════════════════════════════════════');
  console.log('');

  // ── 收残留实例 ──
  const stale = collectStalePids();
  if (stale.length) {
    console.log('· 发现旧的实例（PID ' + stale.join(', ') + '），先停掉它');
    for (const pid of stale) killPid(pid);
    await sleep(1000);
  }
  try { fs.unlinkSync(PORTFILE); } catch (e) {}

  // ── 起服务（日志落 .server.log，与之前的行为一致）──
  try { fs.writeFileSync(LOG, ''); } catch (e) {}
  const logFd = fs.openSync(LOG, 'a');
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')],
    { cwd: ROOT, stdio: ['ignore', logFd, logFd], detached: false });

  let stopped = false;
  const stop = () => {
    if (stopped) return; stopped = true;
    console.log('');
    console.log('· 正在停止服务…');
    try { srv.kill(IS_WIN ? undefined : 'SIGTERM'); } catch (e) {}
    // SIGTERM 1.2 秒内没退就 SIGKILL 兜底（个别环境下 SIGTERM 会被吞，实测踩过）
    setTimeout(() => { try { srv.kill('SIGKILL'); } catch (e) {} }, 1200).unref();
    try { fs.unlinkSync(PORTFILE); } catch (e) {}
  };
  // 信号进来：先礼后兵地停服务，服务退出事件负责收尾退出；
  // 3 秒硬兜底防止极端情况下挂住不退。
  const onSignal = () => { stop(); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('SIGHUP', () => { stop(); process.exit(0); });
  srv.on('exit', () => { if (!stopped) { stopped = true; try { fs.unlinkSync(PORTFILE); } catch (e) {} } process.exit(0); });

  // ── 等 .port 文件（服务端在 listening 回调里写出，端口是真实绑定值）──
  // ⚠️ 不要去解析日志的第一行 READY：默认端口被占时服务会顺延端口，
  //    日志里有多行 READY，取第一行会打开**错误的端口**（修过一次的真 bug）。
  let url = '';
  for (let i = 0; i < 60; i++) {
    if (srv.exitCode !== null) break;
    try {
      const p = fs.readFileSync(PORTFILE, 'utf8').replace(/\D/g, '');
      if (p) {
        const ok = await ping(Number(p));
        if (ok) { url = 'http://127.0.0.1:' + p + '/'; break; }
      }
    } catch (e) {}
    await sleep(250);
  }
  // 兜底：端口文件万一没写出来，退回读日志 —— 取**最后**一行 READY
  if (!url) {
    try {
      const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(l => l.startsWith('READY '));
      if (lines.length) url = lines[lines.length - 1].replace(/^READY /, '');
    } catch (e) {}
  }

  if (!url) {
    console.log('✗ 服务没有就绪，日志（.server.log）内容：');
    console.log('────────────────────────────────────────');
    try { console.log(fs.readFileSync(LOG, 'utf8')); } catch (e) {}
    console.log('────────────────────────────────────────');
    await pauseIfTTY();
    stop(); process.exit(1);
  }

  console.log('· 服务已就绪：' + url);
  openBrowser(url);
  console.log('');
  console.log('  ✔ 浏览器已打开。用完后关掉这个窗口即可停止服务。');
  console.log('  （看日志：终端里输入  tail -f .server.log）');
  console.log('');

  // 前台挂着，直到服务退出
  await new Promise(resolve => srv.on('exit', resolve));
  process.exit(0);
}

main().catch(async e => {
  console.error('✗ 启动器异常：' + (e && e.stack || e));
  await pauseIfTTY();
  process.exit(1);
});
