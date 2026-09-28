#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 崩铁抽卡分析平台 · 验收「明亮液态玻璃」主题
//
// 用无头 Chrome 打开本地实例，断言玻璃的各层真的生效，并为人工复看留下截图。
// 与 verify-dashboard / verify-divination 不同，这里**必须有一台在跑的服务** ——
// 它验的是 CSS 与浏览器算出后的最终值，不是纯函数。
//
// 用法：
//   node server/server.js &                 # 先起服务（端口以 .port 为准）
//   node tools/verify-glass.js http://127.0.0.1:8799/ [输出目录]
//
// ⚠️ 这一版的主题是**明亮**基底，所以断言与上一版（深色）整体反过来：判底色亮、
//    判文字深、判 --line 是「看得见的结构线」而不是白。改主题方向时这几条必须一起改，
//    否则脚本会用旧口径把新配色判成错的。
//
// ⚠️ 这套断言守的是几条**容易被无心改坏**的隐性约定：
//    ① 小元件的两条 backdrop-filter 必须「先纯 CSS、后带 url(#lg-refract)」——
//       顺序反了，Safari / Firefox 会把整条都丢掉，那些按钮就彻底没有模糊；
//    ② --sh3 必须是**四向** inset（上亮下暗），退回单向下高光就不再是「一片玻璃的厚度」；
//    ③ 大面板不许挂 url() 折射（位移开销随面积走）；侧栏挂的是更便宜的
//       #lg-refract-lg（单次位移、不带色散）；
//    ④ --line / --line2 是**结构线**（表格行线、图表坐标轴要用），绝不能被改成白色 ——
//       一改，表格线在同色底上直接消失。玻璃的亮白边走 --sh3 与 6e 的 border-color；
//    ⑤ #lg-refract 的色散靠「三通道各拆一条 + screen 合回」实现，
//       换成别的混合模式会把整片压亮（screen 在互不重叠的单通道上才等价于相加）；
//    ⑥ 指针高光只在 glass 主题下挂监听，切走要摘掉；开了「减弱动态效果」一律不挂。
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
  const cssVar = n => raw('getComputedStyle(document.documentElement).getPropertyValue(' + JSON.stringify(n) + ').trim()');
  const alphaOf = s => Number((String(s).match(/[\d.]+\)$/) || ['1)'])[0].replace(')', ''));
  const rgbOf = s => (String(s).match(/[\d.]+/g) || []).map(Number);

  console.log('· 打开 ' + APP);
  await send('Page.navigate', { url: APP });
  if (!await waitFor('.side')) throw new Error('首次加载 .side 没出来');
  await sleep(800);

  // ══ 一、glass 主题下的断言 ══════════════════════════════════════════════════
  console.log('\n① 折射滤镜本体（两条：带色散的小元件版 / 单次位移的侧栏版）');
  await setLang('zh');
  await setTheme('glass');

  const f1 = await json(`(()=>{const fl=document.getElementById('lg-refract');
    if(!fl) return JSON.stringify({missing:1});
    return JSON.stringify({
      dm: fl.querySelectorAll('feDisplacementMap').length,
      cm: fl.querySelectorAll('feColorMatrix').length,
      bl: [...fl.querySelectorAll('feBlend')].map(b=>b.getAttribute('mode')),
      turb: (fl.querySelector('feTurbulence')||{}).getAttribute ? fl.querySelector('feTurbulence').getAttribute('type') : '',
      blur: !!fl.querySelector('feGaussianBlur'),
      sRGB: fl.getAttribute('color-interpolation-filters')
    })})()`);
  ok(!f1.missing, 'SVG 折射滤镜 #lg-refract 已注入');
  ok(f1.dm === 3, '色散折射有三条位移（R / G / B 各弯一次）', 'feDisplacementMap=' + f1.dm);
  ok(f1.cm === 3, '三个通道各拆一条 feColorMatrix', 'feColorMatrix=' + f1.cm);
  ok(f1.bl.length === 2 && f1.bl.every(m => m === 'screen'),
     '用 feBlend screen 合回三通道（换成别的方式会把整片压亮）', f1.bl.join(','));
  ok(f1.turb === 'fractalNoise' && f1.blur, '位移场是「低频噪声 + 高斯平滑」，不是裸噪声');
  ok(f1.sRGB === 'sRGB', 'color-interpolation-filters 显式写 sRGB', f1.sRGB);

  const f2 = await json(`(()=>{const fl=document.getElementById('lg-refract-lg');
    if(!fl) return JSON.stringify({missing:1});
    return JSON.stringify({dm: fl.querySelectorAll('feDisplacementMap').length})})()`);
  ok(!f2.missing, '侧栏专用滤镜 #lg-refract-lg 已注入');
  ok(f2.dm === 1, '侧栏版只做单次位移（三个通道各弯一次放在 100vh 上太贵）', 'feDisplacementMap=' + f2.dm);

  console.log('\n② 明亮基底（这一版的方向就是「亮」，与暗色主题拉开的正是这里）');
  const bg = await raw('getComputedStyle(document.documentElement).backgroundColor');
  const bgr = rgbOf(bg);
  ok(bgr[0] + bgr[1] + bgr[2] > 600, '页面底色是亮的（三通道之和 > 600）', bg);
  ok(bgr[2] >= bgr[0], '底色偏冷（蓝通道 ≥ 红通道）', bg);

  const bgfx = await cssVar('--bgfx');
  ok((bgfx.match(/radial-gradient/g) || []).length >= 4,
     '背景有 ≥4 团彩色（它们就是明亮玻璃的「光源」，少了它就没有光可借）',
     (bgfx.match(/radial-gradient/g) || []).length + ' 团');

  const cardV = await cssVar('--card');
  const cardA = alphaOf(cardV);
  ok(cardA > 0.4 && cardA < 0.62, '面板底色是「透白」（alpha .40~.62）—— 面板的明暗要来自透出来的彩色，不是来自灰', cardV);

  // ⚠️ 读 body 的**算出来的**颜色而不是 token 原值：--tx 是 #rrggbb，
  //    用 /[\d.]+/ 拆会把它整个当成一个数字（101728），断言会假失败。
  const txr = rgbOf(await raw('getComputedStyle(document.body).color'));
  ok(txr[0] + txr[1] + txr[2] < 120, '正文字色是深色（亮底上才读得清）', txr.join(','));

  console.log('\n③ 四层材质');
  const bf = await raw('getComputedStyle(document.querySelector(".st")).backdropFilter');
  const bm = bf.match(/blur\(([\d.]+)px\)/);
  ok(bm && Number(bm[1]) >= 5 && Number(bm[1]) <= 20, '统计卡的模糊量在 5~20px 之间（再高就拖回毛玻璃）', bf);
  ok(/saturate\(1\.[3-9]/.test(bf), '统计卡提了饱和度', bf);
  ok(/contrast\(0?\.[89]/.test(bf), '统计卡**降**了对比度（透过玻璃的颜色更浓、更柔）', bf);
  ok(/brightness\(1\.0[1-9]/.test(bf), '统计卡提了亮度（背景的光穿过来时发亮而不是发灰）', bf);
  ok(!/url\(/.test(bf), '大面板**不带**真折射（位移开销随面积走，只给小元件与侧栏）', bf.slice(0, 60));

  // 小元件：真折射（url 引用）
  const bfBtn = await raw('(()=>{const b=document.querySelector(".btn");return b?getComputedStyle(b).backdropFilter:""})()');
  ok(/lg-refract\b/.test(bfBtn), '按钮挂上了真折射 url(#lg-refract)', bfBtn.slice(0, 70));

  // 侧栏：挂的是更便宜的那条
  const bfSide = await raw('getComputedStyle(document.querySelector(".side")).backdropFilter');
  ok(/lg-refract-lg/.test(bfSide), '侧栏挂的是单次位移的 #lg-refract-lg', bfSide.slice(0, 70));

  // ⚠️ 降级路径的核心：两条 backdrop-filter 的**顺序**。
  //    算出来的样式只能看到「最后生效」的那一条，所以直接取 theme.css 的文本，
  //    按声明顺序读 —— 这是唯一能看到「写了但被后来者覆盖」的方式。
  const cssText = await raw("fetch('theme.css').then(r=>r.text())");
  const ruleBody = (cssText.match(/\[data-theme="glass"\]\s*\.btn[^{]*\{([^}]*)\}/) || [])[1] || '';
  const h = ruleBody.split(';').map(s => s.trim()).filter(s => /^(-webkit-)?backdrop-filter\s*:/.test(s));
  ok(h.length >= 2, '小元件上写了 ≥2 条 backdrop-filter（第一条给全浏览器、第二条加折射）', h.length + ' 条');
  ok(h.length >= 2 && !/url\(/.test(h[0]) && /url\(#lg-refract\)/.test(h[h.length - 1]),
     '顺序是「先纯 CSS、后带 url()」—— 反了 Safari / Firefox 会把整条都丢掉', h.map(x => (x.indexOf('url(') < 0 ? 'plain' : 'url')).join(' → '));

  const bgi = await raw('getComputedStyle(document.querySelector(".st")).backgroundImage');
  ok(/radial-gradient/.test(bgi), '面板有跟随指针的柔光层');
  ok(/linear-gradient/.test(bgi), '面板有对角 sheen');

  const sh = await cssVar('--sh3');
  ok(/inset/.test(sh) && (sh.match(/inset/g) || []).length >= 4, '--sh3 是四向折射亮边', sh.replace(/\s+/g, ' ').slice(0, 80));

  console.log('\n④ 「结构线」与「玻璃亮边」必须分工明确');
  const ln = await cssVar('--line');
  const lnr = rgbOf(ln);
  const lnA = alphaOf(ln);
  ok(lnA > 0.35 && lnA < 0.65, '--line 是半透明的结构线（alpha .35~.65），不是白', ln);
  ok(lnr[0] + lnr[1] + lnr[2] < 720, '--line 是冷灰、不是白（表格行线与图表轴线要靠它才看得见）', ln);

  const l2 = await cssVar('--line2');
  ok(rgbOf(l2).slice(0, 3).reduce((a, b) => a + b, 0) < 720, '--line2 同样是结构线（表格行线 / .dsh-svg 坐标轴在用）', l2);

  const bt = await raw('getComputedStyle(document.querySelector(".st")).borderTopColor');
  const btr = rgbOf(bt);
  ok(btr[0] > 240 && btr[1] > 240 && btr[2] > 240, '玻璃外缘的边框是发亮的白边（不是结构线）', bt);

  console.log('\n⑤ 指针高光');
  const hl = await json(`(async()=>{
    const el=document.querySelector('.st'); if(!el) return JSON.stringify({err:'没有 .st'});
    const b=el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:b.left+b.width*0.3,clientY:b.top+b.height*0.4}));
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return JSON.stringify({mx:el.style.getPropertyValue('--mx'),my:el.style.getPropertyValue('--my')});
  })()`);
  ok(hl.mx && hl.mx.indexOf('%') > 0, '指针高光写入了 --mx', JSON.stringify(hl));
  ok(/^(2[5-9]|3[0-5])(\.\d+)?%$/.test(hl.mx || ''), '--mx 与指针位置吻合（期望 ≈30%）', hl.mx);

  // ⚠️ 减弱动态效果：项目原先没有这条，是这一版补上的
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(700);
  const rm = await json(`(async()=>{
    const el=document.querySelector('.st');
    const b=el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:b.left+b.width*0.3,clientY:b.top+b.height*0.4}));
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return JSON.stringify({mx:el.style.getPropertyValue('--mx'),
                           tr:getComputedStyle(el).transitionDuration});
  })()`);
  ok(!rm.mx || rm.mx === '', '开了「减弱动态效果」后指针高光不再写入（change 事件即时生效）', JSON.stringify(rm));
  ok(/^0s/.test(rm.tr || ''), '同时关掉了悬停动效', rm.tr);
  await send('Emulation.setEmulatedMedia', { media: '', features: [] });
  await sleep(500);

  console.log('\n⑥ 其它主题不受牵连（三套底色是回归钉，改了要一起改这里）');
  const PIN = { vivid: [7, 10, 24], light: [244, 246, 250], dark: [15, 19, 32] };
  for (const t of ['vivid', 'light', 'dark']) {
    await setTheme(t);
    const v = rgbOf(await raw('getComputedStyle(document.documentElement).backgroundColor'));
    ok(v[0] === PIN[t][0] && v[1] === PIN[t][1] && v[2] === PIN[t][2],
       t + ' 的底色没有被这轮改动波及', v.join(',') + '（期望 ' + PIN[t].join(',') + '）');

    const gi = await raw('getComputedStyle(document.querySelector(".st")).backgroundImage');
    ok(!/radial-gradient/.test(gi), t + ' 主题下没有玻璃的指针光团层', gi.slice(0, 46));

    const lmx = await json(`(async()=>{
      const el=document.querySelector('.st');
      const b=el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:b.left+b.width*0.3,clientY:b.top+b.height*0.4}));
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      return JSON.stringify({mx:el.style.getPropertyValue('--mx')});
    })()`);
    ok(!lmx.mx, t + ' 主题下指针高光的监听已摘掉', JSON.stringify(lmx));
  }

  console.log('\n⑦ 页面无 JS 报错');
  ok(pageErrs.length === 0, '浏览过程中没有异常', pageErrs.slice(0, 2).join(' | '));

  // ══ 二、截图 ═══════════════════════════════════════════════════════════════
  console.log('\n⑧ 截图（中文态，人工复看用）');
  await setTheme('glass');
  await raw('(window.scrollTo(0,0),1)');
  await sleep(600);
  await shot('glass-analysis.png');

  await clickNav(2);
  await raw('(window.scrollTo(0,0),1)'); await sleep(700);
  await shot('glass-roles.png');

  await clickNav(5);
  await raw('(window.scrollTo(0,0),1)'); await sleep(700);
  await shot('glass-help.png');

  // 占卜页：整套 --dz-* 令牌（神坛、罗盘、龟壳、铜钱全是 SVG）也要在亮玻璃下成立
  await clickNav(3);
  await raw('(window.scrollTo(0,0),1)'); await sleep(1400);
  await shot('glass-divination.png');

  await clickNav(4);
  await raw('(window.scrollTo(0,0),1)'); await sleep(900);
  await shot('glass-data.png');

  // 角色卡网格特写：玻璃卡 + 稀有度环 + 白色亮边在亮底上的观感
  await clickNav(2);
  await sleep(700);
  try { await shot('glass-grid-clip.png', await clipOf('.grid', 14)); }
  catch (e) { console.log('    · 跳过 .grid 裁剪：' + e.message); }

  // 小元件特写：按钮上的真折射 + 色散最看得出来的地方
  try { await shot('glass-btn-clip.png', await clipOf('.lg', 14)); }
  catch (e) { console.log('    · 跳过 .lg 裁剪：' + e.message); }

  console.log('\n⑨ 英文态（排版走 [data-lang="en"]，与中文是两套）');
  await setLang('en');
  ok(await raw('document.documentElement.getAttribute("data-theme") === "glass"'),
     '切英文后玻璃主题仍在（偏好互不覆盖）');
  ok(/lg-refract\b/.test(await raw('(()=>{const b=document.querySelector(".btn");return b?getComputedStyle(b).backdropFilter:""})()')),
     '英文态下真折射依然生效');
  await raw('(window.scrollTo(0,0),1)'); await sleep(700);
  await shot('glass-analysis-en.png');

  console.log('\n⑩ 另三主题回归截图');
  await setLang('zh');
  for (const t of ['vivid', 'light', 'dark']) {
    await setTheme(t);
    const p = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'regress-' + t + '.png'), Buffer.from(p.data, 'base64'));
    console.log('  ✓ ' + t.padEnd(6) + ' 截图 regress-' + t + '.png');
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
