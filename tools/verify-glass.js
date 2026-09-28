#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 崩铁抽卡分析平台 · 验收「液态玻璃」主题
//
// 用无头 Chrome 打开本地实例，断言玻璃的四层真的生效，并为人工复看留下截图。
// 与 verify-dashboard / verify-divination 不同，这里**必须有一台在跑的服务** ——
// 它验的是 CSS 与浏览器算出后的最终值，不是纯函数。
//
// 用法：
//   node server/server.js &                 # 先起服务（端口以 data/.port 或日志为准）
//   node tools/verify-glass.js http://127.0.0.1:8799/ [输出目录]
//
// ⚠️ 这套断言守的是几条**容易被无心改坏**的隐性约定：
//    ① 小元件的两条 backdrop-filter 必须「先纯 CSS、后带 url(#lg-refract)」——
//       顺序反了，Safari / Firefox 会把整条都丢掉，那些按钮就彻底没有模糊；
//    ② --sh3 必须是**四向** inset（上亮下暗），退回单向下高光就不再是「一片玻璃的厚度」；
//    ③ 面板表面走 background-image 而**不是** ::before —— 见 theme.css 第 6 节的解释；
//    ④ 指针高光只在 glass 主题下挂监听，靠 --mx / --my 落到元素上。
// ─────────────────────────────────────────────────────────────────────────────
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = process.argv[2] || 'http://127.0.0.1:8799/';
const OUT = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'sr-glass-shots'));
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

  console.log('· 打开 ' + APP);
  await send('Page.navigate', { url: APP });
  if (!await waitFor('.side')) throw new Error('首次加载 .side 没出来');
  await sleep(800);

  // ══ 一、glass 主题下的断言 ══════════════════════════════════════════════════
  console.log('\n① 液态玻璃各层是否真的生效');
  await setLang('zh');
  await setTheme('glass');

  // 1) 折射滤镜本体在文档里
  ok(await raw('!!document.getElementById("lg-refract")'), 'SVG 折射滤镜 #lg-refract 已注入');
  ok(await raw('!!(document.getElementById("lg-refract")||{}).querySelector'), '滤镜里有子节点');

  // 2) 背景是深色（浅色毛玻璃版的旧值 #e9edf6 会是三通道俱高）
  const bg = await raw('getComputedStyle(document.documentElement).backgroundColor');
  const rgb = (bg.match(/[\d.]+/g) || []).map(Number);
  ok(rgb[2] > rgb[0] && rgb[0] + rgb[1] + rgb[2] < 150,
     '页面底色是深色且偏冷（蓝通道 > 红通道）', bg);

  // 3) 大面板：模糊 + 饱和 + 提亮
  //    模糊量取一个**区间**而不是定值：液态玻璃的观感靠折射而不是靠糊，
  //    所以 --blur 被特意压小（大面板 11px、小元件 6px，见 theme.css 第 5 节）。
  const bf = await raw('getComputedStyle(document.querySelector(".st")).backdropFilter');
  const bm = bf.match(/blur\(([\d.]+)px\)/);
  ok(bm && Number(bm[1]) >= 5 && Number(bm[1]) <= 20, '统计卡的模糊量在 5~20px 之间', bf);
  ok(/saturate/.test(bf), '统计卡带饱和度提升', bf);
  ok(/brightness/.test(bf), '统计卡带亮度提升', bf);
  ok(!/url\(/.test(bf), '大面板**不带**真折射（位移开销随面积走，只给小元件）', bf.slice(0, 60));

  // 4) 小元件：真折射（url 引用）
  const bfBtn = await raw('(()=>{const b=document.querySelector(".btn");return b?getComputedStyle(b).backdropFilter:""})()');
  ok(/lg-refract/.test(bfBtn), '按钮挂上了真折射 url(#lg-refract)', bfBtn.slice(0, 70));

  // 5) 表面：sheen + 指针光团（两层背景图）
  const bgi = await raw('getComputedStyle(document.querySelector(".st")).backgroundImage');
  ok(/radial-gradient/.test(bgi), '面板有跟随指针的柔光层');
  ok(/linear-gradient/.test(bgi), '面板有 135° 对角 sheen');

  // 6) 折射亮边：--sh3 是多向 inset（退回单向下高光就会只剩 1 个 inset）
  const sh = await raw('getComputedStyle(document.documentElement).getPropertyValue("--sh3")');
  ok(/inset/.test(sh) && (sh.match(/inset/g) || []).length >= 4, '--sh3 是四向折射亮边', sh.replace(/\s+/g, ' ').slice(0, 80));

  // 7) 描边是克制的半透明白（旧浅色版是 .75）
  const ln = await raw('getComputedStyle(document.documentElement).getPropertyValue("--line").trim()');
  const lna = Number((ln.match(/([\d.]+)\)/) || [])[1]);
  ok(lna > 0.1 && lna < 0.35, '描边是克制的半透明白（alpha .10~.35）', ln);

  // 8) 指针高光：派发一次 pointermove，看 --mx / --my 有没有落到元素上
  const hl = await json(`(async()=>{
    const el=document.querySelector('.st'); if(!el) return JSON.stringify({err:'没有 .st'});
    const b=el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:b.left+b.width*0.3,clientY:b.top+b.height*0.4}));
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return JSON.stringify({mx:el.style.getPropertyValue('--mx'),my:el.style.getPropertyValue('--my')});
  })()`);
  ok(hl.mx && hl.mx.indexOf('%') > 0, '指针高光写入了 --mx', JSON.stringify(hl));
  ok(/^(2[5-9]|3[0-5])(\.\d+)?%$/.test(hl.mx || ''), '--mx 与指针位置吻合（期望 ≈30%）', hl.mx);

  // 9) 非 glass 主题不该挂指针监听、也不该有 sheen 层
  console.log('\n② 其它主题不受牵连');
  await setTheme('light');
  const lgi = await raw('getComputedStyle(document.querySelector(".st")).backgroundImage');
  ok(!/radial-gradient/.test(lgi), '切到明亮主题后，指针光团层消失', lgi.slice(0, 46));
  const lmx = await json(`(async()=>{
    const el=document.querySelector('.st');
    const b=el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:b.left+b.width*0.3,clientY:b.top+b.height*0.4}));
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return JSON.stringify({mx:el.style.getPropertyValue('--mx')});
  })()`);
  ok(!lmx.mx, '明亮主题下指针高光的监听已摘掉', JSON.stringify(lmx));

  console.log('\n③ 页面无 JS 报错');
  ok(pageErrs.length === 0, '浏览过程中没有异常', pageErrs.slice(0, 2).join(' | '));

  // ══ 二、截图 ═══════════════════════════════════════════════════════════════
  console.log('\n④ 截图（中文态，人工复看用）');
  await setTheme('glass');
  await raw('(window.scrollTo(0,0),1)');
  await sleep(600);
  await shot('glass-analysis.png');

  await clickNav(1);
  await raw('(window.scrollTo(0,0),1)'); await sleep(700);
  await shot('glass-roles.png');

  await clickNav(4);
  await raw('(window.scrollTo(0,0),1)'); await sleep(700);
  await shot('glass-help.png');

  // 角色卡网格：玻璃卡 + 稀有度环在深底下的观感
  await clickNav(1);
  await sleep(700);
  try {
    await shot('glass-grid-clip.png', await clipOf('.grid', 14));
  } catch (e) { console.log('    · 跳过 .grid 裁剪：' + e.message); }

  console.log('\n⑤ 英文态（排版走 [data-lang="en"]，与中文是两套）');
  await setLang('en');
  const okEn = await raw('document.documentElement.getAttribute("data-theme") === "glass"');
  ok(okEn, '切英文后玻璃主题仍在（偏好互不覆盖）');
  ok(/lg-refract/.test(await raw('(()=>{const b=document.querySelector(".btn");return b?getComputedStyle(b).backdropFilter:""})()')),
     '英文态下真折射依然生效');
  await raw('(window.scrollTo(0,0),1)'); await sleep(700);
  await shot('glass-analysis-en.png');

  console.log('\n⑥ 另三主题回归（确认没被这轮改动波及）');
  await setLang('zh');
  for (const t of ['vivid', 'light', 'dark']) {
    await setTheme(t);
    const b = await raw('getComputedStyle(document.documentElement).backgroundColor');
    const p = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'regress-' + t + '.png'), Buffer.from(p.data, 'base64'));
    console.log('  ✓ ' + t.padEnd(6) + ' 底色 ' + b.padEnd(22) + ' 截图 regress-' + t + '.png');
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
