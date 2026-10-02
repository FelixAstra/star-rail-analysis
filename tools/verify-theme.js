#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Star Rail Warp Analyzer · 验收三套主题（vivid / light / dark）
//
// 用无头 Chrome 打开本地实例，把三套主题的底色钉住，并为人工复看留下截图。
// 与 verify-dashboard / verify-divination 不同，这里**必须有一台在跑的服务** ——
// 它验的是 CSS 与浏览器算出后的最终值，不是纯函数。
//
// 用法：
//   node server/server.js &                 # 先起服务（端口以 .port 为准）
//   node tools/verify-theme.js http://127.0.0.1:8799/ [输出目录]
//
// ⚠️ 下面的 PIN 是三套主题 token 的回归钉：改了 theme.css 的 --bg 就要一起改这里，
//    否则脚本会用旧口径把新配色判成错的。
// ─────────────────────────────────────────────────────────────────────────────
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = process.argv[2] || 'http://127.0.0.1:8799/';
const OUT = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'sr-theme-shots'));
const CHROME = process.env.CHROME_BIN ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!fs.existsSync(CHROME)) { console.error('✗ 找不到 Chrome：' + CHROME + '（可用 CHROME_BIN 覆盖）'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

// ⚠️ 调试端口随机：异常退出没杀干净的上一轮 Chrome 会让 /json/list 连到旧浏览器，
//    症状是 navigate 成功但页面永远空白。
const PORT = 9600 + Math.floor(Math.random() * 300);
const PROF = fs.mkdtempSync('/tmp/wb-lg-prof-');
const ERRLOG = path.join(os.tmpdir(), 'sr-lg-chrome.err');

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF,
  '--no-proxy-server', '--no-first-run', '--no-default-browser-check',
  // ⚠️ 与 tools/verify-i18n.js 保持一致。本机无头 Chrome 缺了这几个会被拦在启动阶段
  //    （它自己要去删 RLZ / code_sign_clone 的临时文件），表现为静默秒退、一个字都不打。
  '--in-process-gpu', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=1440,1100', 'about:blank',
], { stdio: ['ignore', 'ignore', fs.openSync(ERRLOG, 'w')] });
// ⚠️ 必须显式 kill：spawn 出来的 Chrome 会吊住 node 的事件循环
const killChrome = () => { try { chrome.kill('SIGKILL'); } catch (e) {} };
process.on('exit', killChrome);
process.on('uncaughtException', e => { console.error('ERR', (e && e.stack) || e); killChrome(); process.exit(1); });

const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (cond, msg, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + msg); return true; }
  fail++; console.log('  ✗ ' + msg + (extra != null ? '  → ' + extra : '')); return false;
};

(async () => {
  let page = null;
  for (let i = 0; i < 80 && !page; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { /* 还没起来 */ }
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('连不上无头 Chrome 的调试端口 ' + PORT);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  const pageErrs = [];
  let seq = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      pageErrs.push((d.exception && d.exception.description) || d.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      pageErrs.push('console.error: ' + m.params.args.map(a => a.value || a.description).join(' '));
    }
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  };
  const send = (method, params) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const raw = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || 'eval 失败');
    return r.result && r.result.value;
  };
  const json = async expr => {
    const v = await raw(expr);
    return typeof v === 'string' ? JSON.parse(v) : v;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });

  const waitFor = async (sel, ms) => {
    for (let i = 0; i < (ms || 30000) / 250; i++) {
      await sleep(250);
      if (await raw('!!document.querySelector(' + JSON.stringify(sel) + ')')) return true;
    }
    return false;
  };

  /** 写偏好并 reload，然后**断言属性真的变了** —— 不验就会被「其实没切」骗过去 */
  const setPref = async (key, val, attr) => {
    await raw('try{localStorage.setItem(' + JSON.stringify(key) + ',' + JSON.stringify(val) + ')}catch(e){};1');
    await send('Page.reload', { ignoreCache: true });
    if (!await waitFor('.side')) throw new Error('reload 后 .side 没出来');
    await sleep(1000);
    const got = await raw('document.documentElement.getAttribute(' + JSON.stringify(attr) + ')');
    if (got !== val) throw new Error(attr + ' 没切到 ' + val + '（实得 ' + got + '）');
  };
  const setTheme = t => setPref('sr.theme', t, 'data-theme');
  const setLang = l => setPref('sr.lang', l, 'data-lang');

  const shot = async (file, clip) => {
    const args = { format: 'png' };
    if (clip) { args.clip = clip; args.captureBeyondViewport = true; }
    const p = await send('Page.captureScreenshot', args);
    const buf = Buffer.from(p.data, 'base64');
    fs.writeFileSync(path.join(OUT, file), buf);
    console.log('    · ' + file.padEnd(26) + (buf.length / 1024).toFixed(0).padStart(4) + ' KB');
  };
  const clipOf = async (sel, pad) => {
    const r = await json('(()=>{const e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)return JSON.stringify({err:"无"});' +
      'const b=e.getBoundingClientRect();return JSON.stringify({x:b.left,y:b.top+window.scrollY,w:b.width,h:b.height})})()');
    if (r.err) throw new Error(sel + ' ' + r.err);
    const p = pad === undefined ? 12 : pad;
    return { x: Math.max(0, r.x - p), y: Math.max(0, r.y - p), width: r.w + p * 2, height: Math.min(6000, r.h + p * 2), scale: 2 };
  };
  const clickNav = async i => {
    const okc = await raw('(()=>{const b=document.querySelectorAll(".side .navi")[' + i + '];if(!b)return 0;b.click();return 1})()');
    if (!okc) throw new Error('导航第 ' + i + ' 项点不到');
    await sleep(900);
  };
  const cssVar = n => raw('getComputedStyle(document.documentElement).getPropertyValue(' + JSON.stringify(n) + ').trim()');
  const alphaOf = s => Number((String(s).match(/[\d.]+\)$/) || ['1)'])[0].replace(')', ''));
  const rgbOf = s => (String(s).match(/[\d.]+/g) || []).map(Number);

  console.log('· 打开 ' + APP);
  await send('Page.navigate', { url: APP });
  if (!await waitFor('.side')) throw new Error('首次加载 .side 没出来');
  await sleep(800);


  console.log('\n① 三套主题的底色（回归钉：改了 theme.css 就要一起改这里）');
  const PIN = { vivid: [7, 10, 24], light: [244, 246, 250], dark: [15, 19, 32] };
  for (const t of ['vivid', 'light', 'dark']) {
    await setTheme(t);
    const v = rgbOf(await raw('getComputedStyle(document.documentElement).backgroundColor'));
    ok(v[0] === PIN[t][0] && v[1] === PIN[t][1] && v[2] === PIN[t][2],
       t + ' 的底色与钉住的 token 一致', v.join(',') + '（期望 ' + PIN[t].join(',') + '）');

    // 主题选择器里只该有三颗色卡：多出一颗就说明 THEMES 与 styles.css 不同步
    const sw = await raw('document.querySelectorAll(".thm-sw").length');
    ok(sw === 3, t + ' 主题下主题选择器正好三颗色卡', 'thm-sw=' + sw);
  }

  console.log('\n② 页面无 JS 报错');
  ok(pageErrs.length === 0, '浏览过程中没有异常', pageErrs.slice(0, 2).join(' | '));

  console.log('\n③ 三套主题各截一张（人工复看用）');
  await setLang('zh');
  for (const t of ['vivid', 'light', 'dark']) {
    await setTheme(t);
    await raw('(window.scrollTo(0,0),1)');
    await sleep(700);
    const p = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'theme-' + t + '.png'), Buffer.from(p.data, 'base64'));
    console.log('  ✓ ' + t.padEnd(6) + ' 截图 theme-' + t + '.png');
  }

  console.log('\n' + (fail === 0 ? '全部通过' : '有失败项') + '：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('截图目录：' + OUT);

  killChrome();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('ERR ' + ((e && e.stack) || e));
  killChrome();
  process.exit(1);
});
