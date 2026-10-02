#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Star Rail Warp Analyzer · 重拍 README 配图（4 张）
//
//   analysis.png    1200×750   抽卡分析页：七张总貌卡 + 当期卡池识别
//   divination.png  1200×750   八卦占卜页：卡池倒计时 + 罗盘 + 六爻起卦面板
//   roles.png       1200×750   角色管理页：五星角色 × 专属光锥配对卡
//   themes.png      1200×816   同一页在三套主题下的样子（2 列拼图，前两格一行、第三格横跨居中）
//
// 用法：
//   # 1) 铺演示数据 + 起服务（**别拿真实账号数据拍**，会把抽卡史拍进公开仓库）
//   node tools/make-demo-data.js --force
//   node server/server.js &
//   # 2) 拍照（公开配图用英文界面，与英文 README 一致）
//   node tools/shoot-readme.js http://127.0.0.1:8799/ ./assets/readme --lang=en
//   # 只重拍某几张（例如主题观感变了，只需重拍拼图）：
//   node tools/shoot-readme.js http://127.0.0.1:8800/ ./assets/readme --lang=en --only=themes.png
//
// ⚠️ 截的是**视口**而不是元素：README 里按 880px 宽展示，固定一个「取景刚好」的
//    视口尺寸即可，不必跟着页面高度走（元素裁剪在长页面上很难稳定）。
// ⚠️ themes 拼图用 Data URI 把三张图内嵌进一个本地 HTML —— 免得为了拼图去依赖
//    ImageMagick 之类的本机工具（零依赖是这个项目的一贯约定）。
// ⚠️ 调试端口必须随机：异常退出没杀干净的上一轮 Chrome 会让 /json/list 连到旧浏览器，
//    症状是 navigate 成功但页面永远空白。
// ─────────────────────────────────────────────────────────────────────────────
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = process.argv[2] || 'http://127.0.0.1:8799/';
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'assets/readme'));
const LANG = (process.argv.find(a => a.indexOf('--lang=') === 0) || '--lang=en').split('=')[1];
// --only=themes.png[,roles.png] 只重拍指定的几张。
// 主题换了观感却只动了一张图时用它 —— 另外几张里的「分析于 <时间戳>」会凭空变化，
// 白白让 diff 变脏。
const ONLY = (() => {
  const a = process.argv.find(x => x.indexOf('--only=') === 0);
  return a ? a.split('=')[1].split(',').map(s => s.trim()).filter(Boolean) : null;
})();
const want = f => !ONLY || ONLY.indexOf(f) >= 0;
const CHROME = process.env.CHROME_BIN ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// 三套主题：key 与 web/app.js 的 THEMES 一致（配色定义在 web/theme.css）
const THEMES = [['vivid', 'Vivid (default)'], ['light', 'Light'], ['dark', 'Dark']];
const W = 1200, H = 750;        // 单页取景
const WH = 816;                 // 拼图总高（2 行 × 408）

if (!fs.existsSync(CHROME)) { console.error('✗ 找不到 Chrome：' + CHROME + '（可用 CHROME_BIN 覆盖）'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const PORT = 9200 + Math.floor(Math.random() * 700);
const PROF = fs.mkdtempSync('/tmp/wb-readme-prof-');

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF,
  '--no-proxy-server', '--no-first-run', '--no-default-browser-check',
  // ⚠️ 这四个跟 tools/verify-i18n.js 保持一致：本机无头 Chrome 缺了它们会被
  //    沙箱拦在启动阶段（拦的是它自己的 RLZ / code_sign_clone 临时文件），
  //    表现是「脚本 3 秒就退出、stdout 一个字都没有」。
  '--in-process-gpu', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank',
], { stdio: 'ignore' });
// ⚠️ 必须显式 kill：spawn 出来的 Chrome 会吊住 node 的事件循环，只设 exitCode 命令会挂死
const killChrome = () => { try { chrome.kill('SIGKILL'); } catch (e) {} };
process.on('exit', killChrome);
process.on('uncaughtException', e => { console.error('ERR', (e && e.stack) || e); killChrome(); process.exit(1); });

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let page = null;
  for (let i = 0; i < 80 && !page; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { /* 端口还没起来 */ }
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('连不上无头 Chrome 的调试端口 ' + PORT);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
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
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || 'eval 失败');
    return r.result && r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');

  const setViewport = (w, h) =>
    send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });

  /** 等页面真的就绪：侧栏在、分析数据到、7 张总貌卡渲染完、图标解码完 */
  const waitReady = async () => {
    for (let i = 0; i < 120; i++) {
      await sleep(250);
      const ok = await raw('document.querySelectorAll(".side .navi").length >= 5 && document.querySelectorAll(".sts > *").length === 7');
      if (ok) break;
    }
    // 懒加载图标：不滚一遍就不解码（不滚不会空图，但滚动一次更稳）
    await raw('(async()=>{const H=document.body.scrollHeight;for(let y=0;y<H;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,50));}window.scrollTo(0,0);await new Promise(r=>setTimeout(r,300));return 1})()');
    await sleep(700);
  };

  const gotoAndWait = async url => {
    await send('Page.navigate', { url });
    await waitReady();
  };

  /** 写偏好（语言 / 主题）并 reload —— 两个 key 都被 index.html 的防闪烁内联脚本读取 */
  const setPref = async (key, val, attr) => {
    await raw('try{localStorage.setItem(' + JSON.stringify(key) + ',' + JSON.stringify(val) + ')}catch(e){};1');
    await send('Page.reload', { ignoreCache: true });
    await waitReady();
    const got = await raw('document.documentElement.getAttribute(' + JSON.stringify(attr) + ')');
    if (got !== val) throw new Error(attr + ' 没切到 ' + val + '（实际 ' + got + '）');
  };

  const clickNav = async idx => {
    const ok = await raw('(()=>{const b=document.querySelectorAll(".side .navi")[' + idx + '];if(!b)return 0;b.click();return 1})()');
    if (!ok) throw new Error('左侧导航第 ' + idx + ' 项点不到');
    await raw('window.scrollTo(0,0)');
    await sleep(900);
  };

  const grab = async file => {
    const p = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(p.data, 'base64');
    fs.writeFileSync(path.join(OUT, file), buf);
    console.log('  ✔ ' + file.padEnd(16) + (buf.length / 1024).toFixed(0).padStart(5) + ' KB');
  };

  /**
   * 拍一页。
   * ⚠️ 英文界面比中文**高**：同样 1200×750，中文能拍到「七张卡 + 卡池表」，
   *    英文只够拍到七张卡；角色管理页更夸张 —— 说明块就把一屏占满了。
   *    所以每页各自给一个取景：要么加高视口，要么滚到目标区块。
   * @param opt {{w?:number,h?:number,sel?:string,pad?:number}} sel 给了就滚到该元素顶部
   */
  const shotPage = async (navIdx, file, opt) => {
    if (!want(file)) { console.log('  · 跳过 ' + file + '（--only 未选中）'); return; }
    const o = opt || {};
    await setViewport(o.w || W, o.h || H);
    await clickNav(navIdx);
    if (o.sel) {
      const pad = o.pad === undefined ? 12 : o.pad;
      const ok = await raw('(()=>{const e=document.querySelector(' + JSON.stringify(o.sel) + ');'
        + 'if(!e)return 0;window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - ' + pad + ');return 1})()');
      if (!ok) throw new Error('找不到取景区块 ' + o.sel);
    } else {
      await raw('window.scrollTo(0,0)');
    }
    await sleep(800);
    await grab(file);
  };

  // ── 应用三张：统一 1200×750 视口，只拍首屏 ──────────────────────────────────
  console.log('· 打开 ' + APP + '（界面语言 ' + LANG + '）');
  await setViewport(W, H);
  await gotoAndWait(APP);
  await setPref('sr.lang', LANG, 'data-lang');
  await setPref('sr.theme', 'vivid', 'data-theme');   // README 的主图用默认主题

  await shotPage(0, 'analysis.png', { w: 1200, h: 900 });        // 900 高：页头 + 七张总貌卡刚好一屏
  await shotPage(1, 'roles.png', { sel: '.pgrid' });             // 滚过「怎么读这两张图」的说明块
  await shotPage(2, 'divination.png', {});

  // ── 三主题拼图：2 列，前两格一行、第三格横跨居中 ────────────────────────────
  if (!want('themes.png')) {
    console.log('  · 跳过 themes.png（--only 未选中）');
  } else {
  await setViewport(W, WH);
  const tiles = [];
  for (const [key, label] of THEMES) {
    await setPref('sr.theme', key, 'data-theme');
    await clickNav(0);
    const p = await send('Page.captureScreenshot', { format: 'png' });
    tiles.push({ label, b64: p.data });
    console.log('  · 主题 ' + key + ' 已拍');
  }
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = '<!doctype html><meta charset="utf-8"><style>'
    + 'html,body{margin:0;background:#05070f}'
    + '.g{display:grid;grid-template-columns:600px 600px;grid-auto-rows:408px}'
    + '.c{position:relative;width:600px;height:408px;overflow:hidden;outline:1px solid rgba(255,255,255,.06)}'
    + '.c img{width:600px;height:408px;display:block}'
    + '.c.last{grid-column:1/3;justify-self:center}'
    + '.c span{position:absolute;left:0;top:0;padding:7px 13px;font:650 15px/1.2 '
    + '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#fff;'
    + 'background:rgba(5,9,20,.74);letter-spacing:.2px}'
    + '</style><div class="g">'
    + tiles.map((t, i) => '<div class="c' + (i === tiles.length - 1 && tiles.length % 2 ? ' last' : '') + '">'
        + '<img src="data:image/png;base64,' + t.b64 + '"><span>' + esc(t.label) + '</span></div>').join('')
    + '</div>';
  const fig = path.join(PROF, 'themes.html');
  fs.writeFileSync(fig, html);
  await send('Page.navigate', { url: 'file://' + fig });
  await sleep(1200);
  await grab('themes.png');
  }

  console.log('✔ 全部完成，输出目录 ' + OUT);
  ws.close();
  killChrome();
  process.exitCode = 0;
})().catch(e => {
  // ⚠️ 必须显式接住：Node ≥15 里未处理的 rejection 会直接 FATAL 掉进程，
  //    而且退出码是 0、stderr 也可能一个字都没有 —— 表现成「脚本跑完但什么都没做」。
  console.error('ERR ' + ((e && e.stack) || e));
  killChrome();
  process.exit(1);
});
