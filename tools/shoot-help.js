#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 崩铁抽卡分析平台 · 重拍「解释说明」页配图
//
// 用无头 Chrome 的 CDP 按元素裁剪，把 assets/help/ 下十张图重拍一遍。
// 零依赖（靠 Node 22 自带的全局 WebSocket + fetch）。
//
// 用法：
//   # 1) 铺演示数据 + 起服务（别拿真实账号数据拍，会把抽卡史拍进公开仓库）
//   node tools/make-demo-data.js --force
//   node server/server.js &
//   # 2) 拍照
//   node tools/shoot-help.js http://127.0.0.1:8799/ ./assets/help
//
// ⚠️ 会**直接覆盖** assets/help/ 里的同名文件，先备份。
// ⚠️ 页面图标是 loading="lazy" —— 不把整页滚一遍，量到的 naturalWidth 恒为 0。
//    脚本里的 scrollThrough() 就是干这个的，别删。
// ⚠️ 调试端口必须随机：上一轮异常退出没杀干净时，固定端口会让新 Chrome 绑不上，
//    而 fetch(/json/list) 会**连到上一轮的旧浏览器**（症状：navigate 成功但页面永远空白）。
// ─────────────────────────────────────────────────────────────────────────────
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = process.argv[2] || 'http://127.0.0.1:8799/';
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'assets/help'));
const CHROME = process.env.CHROME_BIN ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!fs.existsSync(CHROME)) { console.error('✗ 找不到 Chrome：' + CHROME + '（可用 CHROME_BIN 覆盖）'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const PORT = 9300 + Math.floor(Math.random() * 600);
const PROF = fs.mkdtempSync('/tmp/wb-shot-prof-');

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF,
  '--no-proxy-server', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=1440,1100', 'about:blank',
], { stdio: 'ignore' });
// ⚠️ 必须显式 kill：spawn 出来的 Chrome 会吊住 node 的事件循环，
//    只写 process.exitCode 的话 node 永远不退出（命令挂死），process.on('exit') 也救不到。
const killChrome = () => { try { chrome.kill('SIGKILL'); } catch (e) {} };
process.on('exit', killChrome);
process.on('uncaughtException', e => { console.error('ERR', e && e.message); killChrome(); process.exit(1); });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 元素表达式工具 ──────────────────────────────────────────────────────────
const q = sel => 'document.querySelector(' + JSON.stringify(sel) + ')';
const dmCard = t => '[...document.querySelectorAll(".dm .card")].find(c=>(c.querySelector("h3")||{}).textContent.includes(' + JSON.stringify(t) + '))';
const dmSub = (t, sub) => '(()=>{const c=' + dmCard(t) + ';return c?c.querySelector(' + JSON.stringify(sub) + '):null})()';

(async () => {
  // ── 连上页面 target（注意：是 /json/list 里的 page，不是 /json/version）──────
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval 失败');
    return r.result && r.result.value;
  };
  // ⚠️ returnByValue 对 async IIFE 返回的是 **JSON 字符串**，直接当对象用会静默拿到一堆
  //    undefined —— 所以统一 JSON.parse 一次（这个坑已经踩过两次）。
  const json = async expr => {
    const v = await raw(expr);
    return typeof v === 'string' ? JSON.parse(v) : v;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });

  const gotoUrl = async (url, waitSel) => {
    await send('Page.navigate', { url });
    for (let i = 0; i < 120; i++) {
      await sleep(250);
      if (await raw('!!document.querySelector(' + JSON.stringify(waitSel) + ')')) return;
    }
    throw new Error('等不到 ' + waitSel + '（' + url + '）');
  };
  const toTop = () => raw('(window.scrollTo(0,0), 1)');
  // 滚完整页：图标是 lazy 的，不滚过一遍就不加载
  const scrollThrough = async () => {
    await raw('(async()=>{const H=document.body.scrollHeight;for(let y=0;y<H;y+=500){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,60));}window.scrollTo(0,H);await new Promise(r=>setTimeout(r,250));window.scrollTo(0,0);await new Promise(r=>setTimeout(r,400));return 1})()');
  };
  const clickNav = async name => {
    const ok = await raw('(()=>{const b=[...document.querySelectorAll(".side .navi")].find(x=>x.textContent.includes(' + JSON.stringify(name) + '));if(!b)return 0;b.click();return 1})()');
    if (!ok) throw new Error('找不到左侧导航「' + name + '」');
    await sleep(800);
  };

  // ── 按元素裁剪 ────────────────────────────────────────────────────────────
  // ⚠️ clip 用的是**页面绝对坐标**：getBoundingClientRect().top 是视口坐标，
  //    滚过页面之后必须 + window.scrollY，否则截出来永远是页面顶部。
  const clipBy = async (elExpr, file, opt) => {
    const o = opt || {};
    const pad = o.pad === undefined ? 10 : o.pad;
    await toTop();
    const r = await json('(()=>{try{const e=(' + elExpr + ');if(!e)return JSON.stringify({err:"元素不存在"});const b=e.getBoundingClientRect();' +
      'return JSON.stringify({x:b.left,y:b.top+window.scrollY,w:b.width,h:b.height})}catch(err){return JSON.stringify({err:String(err&&err.message)})}})()');
    if (r.err) throw new Error(r.err + ' ← ' + elExpr.slice(0, 90));
    if (r.w < 2 || r.h < 2) throw new Error('元素尺寸为 0 ← ' + elExpr.slice(0, 90));
    const clip = {
      x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad),
      width: Math.min(o.maxW || 1440, r.w + pad * 2),
      height: Math.min(o.maxH || 6000, r.h + pad * 2),
      scale: o.scale || 2,
    };
    const p = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
    const buf = Buffer.from(p.data, 'base64');
    fs.writeFileSync(path.join(OUT, file), buf);
    console.log('  ✔ ' + file.padEnd(22) + (Math.round(clip.width * clip.scale) + 'x' + Math.round(clip.height * clip.scale)).padStart(11) +
      '  ' + (buf.length / 1024).toFixed(0).padStart(4) + ' KB   ← ' + elExpr.slice(0, 56));
  };

  console.log('· 打开 ' + APP);
  await gotoUrl(APP, '.side');
  await sleep(1500);
  await scrollThrough();
  const st = await json('JSON.stringify({uid:(document.querySelector(".sfoot b")||{}).textContent,cards:document.querySelectorAll(".sts > *").length})');
  console.log('· 已加载 UID=' + st.uid + ' · 总貌卡 ' + st.cards + ' 张');

  // ── 01 抽卡总结（示意图）──────────────────────────────────────────────────
  // 原来这张是第三方统计工具的界面截图 —— 既含账号数据、又是别人的产品界面，
  // 公开版不能留，改成一张自绘示意图：只讲「平台从总结页取哪两个数」。
  const base = await json('fetch("/api/analysis").then(r=>r.json()).then(j=>JSON.stringify({p:j.overview.wsBase.pulls,g:j.overview.wsBase.gold}))');
  const fig1 = path.join(PROF, 'fig1.html');
  fs.writeFileSync(fig1, `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#eef2f9;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
#card{width:760px;background:#fff;border:1px solid #e3e8f2;border-radius:14px;padding:24px 28px}
h2{margin:0 0 6px;font-size:18px;font-weight:650;color:#2b3550}
.sub{font-size:13px;color:#8894a8;margin-bottom:20px}
.kv{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.it{background:#f8fafd;border:1px solid #e3e8f2;border-radius:10px;padding:13px 15px}
.k{font-size:12px;color:#8894a8;margin-bottom:4px}
.v{font-size:28px;font-weight:650;color:#2b3550;font-variant-numeric:tabular-nums}
.note{margin-top:18px;font-size:13px;color:#5c6880;line-height:1.85}
.note b{color:#2b3550}
</style>
<div id="card">
  <h2>抽卡总结（示意图）</h2>
  <div class="sub">第三方统计工具 / 游戏内总结页上能看到的两个汇总数</div>
  <div class="kv">
    <div class="it"><div class="k">总抽数</div><div class="v">${base.p}</div></div>
    <div class="it"><div class="k">五星数</div><div class="v">${base.g}</div></div>
  </div>
  <div class="note">「抓取与数据管理 → ④ 数据补填」读的就是这两个数：官方接口只保留约 1 年，<b>逐条记录重算永远比总量少</b>，所以总量只能照抄；出金率这类比率才用逐条记录实时算。</div>
</div>`);
  await gotoUrl('file://' + fig1, '#card');
  await sleep(300);
  await clipBy(q('#card'), '01-summary.png', { pad: 0, maxW: 800, maxH: 900, scale: 2 });

  // ── 回到应用 ─────────────────────────────────────────────────────────────
  await gotoUrl(APP, '.side');
  await sleep(1500);
  await scrollThrough();

  // 02 数据总貌（7 张卡）
  await clipBy(q('.sts'), '02-overview.png', { pad: 12, maxW: 1440, maxH: 700 });

  // ── 数据管理页 ───────────────────────────────────────────────────────────
  await clickNav('抓取与数据管理');
  await scrollThrough();
  // 03 只截表格（不要卡片外框与标题，跟旧版取景一致）
  await clipBy(dmSub('③ 各卡池时间边界', '.tb'), '03-pool-bounds.png', { pad: 10, maxH: 900 });
  await clipBy(dmCard('① 抓取新的抽卡记录'), '08-manage.png', { pad: 12, maxH: 1400 });
  await clipBy(dmCard('④ 数据补填'), '09-fill.png', { pad: 12, maxH: 1600 });

  // ── 10 外部统计补录：合成一张「角色列表」塞进上传口，等识别完再截 ──────────
  const lib = await json('fetch("/api/iconlib").then(r=>r.json()).then(j=>JSON.stringify((j.ch||[]).filter(x=>x.rarity>=5).slice(0,6).map(x=>({id:x.id,name:x.name,dir:x.dir}))))');
  const fillOk = await raw(`(async()=>{
    const picks = ${JSON.stringify(lib)};
    // ⚠️ 图标之间的间距必须够大（这里 46px ≈ 图标边长的 1/3）——
    //    挤在一起时相邻图标会被「连通域 → 紧包围盒」粘成一个大框，
    //    裁剪结果里塞进两个头像，NCC 自然全错（实测间距 14px 时 6 个里只认对 1 个）。
    const W = 3, S = 150, GAP = 46, PAD = 46;
    const ROWS = Math.ceil(picks.length / W);
    const cv = document.createElement('canvas');
    cv.width = PAD * 2 + W * S + (W - 1) * GAP;
    cv.height = PAD * 2 + ROWS * S + (ROWS - 1) * GAP;
    const g = cv.getContext('2d');
    g.fillStyle = '#2b3550'; g.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < picks.length; i++) {
      const cx = PAD + (i % W) * (S + GAP), cy = PAD + Math.floor(i / W) * (S + GAP);
      const im = await new Promise(r => { const x = new Image(); x.onload = () => r(x); x.onerror = () => r(null); x.src = 'assets/' + picks[i].dir + '/' + picks[i].id + '.png'; });
      if (im) g.drawImage(im, cx, cy, S, S);
    }
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    const inp = document.querySelector('.dm .imp-drop input[type=file]');
    if (!inp) return 'no-input';
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'demo-roster.png', { type: 'image/png' }));
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
  if (fillOk !== 'ok') throw new Error('往上传口塞合成图失败：' + fillOk);
  let rows = 0;
  for (let i = 0; i < 160; i++) {
    await sleep(500);
    rows = await raw('document.querySelectorAll(".dm .imp .imp-tb tbody tr").length');
    if (rows >= 1) break;
  }
  console.log('· 外部统计识别出 ' + rows + ' 行');
  await sleep(600);
  await clipBy(dmCard('⑤ 外部统计补录'), '10-external.png', { pad: 12, maxH: 3000 });

  // ── 04 / 05 当期卡池识别 ─────────────────────────────────────────────────
  await clickNav('抽卡分析');
  await scrollThrough();
  await clipBy(q('.btabs'), '04-banners.png', { pad: 10, maxH: 1200 });
  await raw('(()=>{const d=document.querySelector(".bpane-11 details.pool-row");if(d)d.open=true;return 1})()');
  await sleep(700);
  await scrollThrough();
  await clipBy(q('.bpane-11 details.pool-row[open]'), '05-detail.png', { pad: 10, maxH: 1200 });

  // ── 06 / 07 角色管理两页 ─────────────────────────────────────────────────
  await clickNav('角色管理');
  await scrollThrough();
  await clipBy(q('.pgrid'), '06-roles.png', { pad: 12, maxH: 2400 });
  await clipBy(q('.g5l'), '07-cones.png', { pad: 12, maxH: 2400 });

  console.log('✔ 全部完成，输出目录 ' + OUT);
  ws.close();
  killChrome();
  process.exitCode = 0;
})();
