#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 双语**运行时**验收：用无头 Chrome 真的把页面渲染出来，扫 DOM 里残留的中文。
//
// 为什么静态校验（tools/check-i18n.js）不够：
//   · 那层只能看 t('…') 字面量；引擎/常量表在**运行时**塞进来的中文它看不见，
//     （卡池名、命途、数据来源、起卦法名、图鉴归属……全是这一类）；
//   · 也看不见「模板里 t() 包了但包错地方」「拼接后中英混排」这类问题。
// 所以两层都要：静态查漏词条，运行时查真实渲染结果。
//
// 判定方式：把页面里每个含中文的文本节点连它所在的 class 一起抓出来，
//   按 --expect 给出的「内容层白名单」过一遍 —— 白名单外还有中文就是失败。
//   白名单里的东西（卦辞爻辞 / 白话 / 黄历术语 / 十二时辰）**是刻意保留的中文**，
//   英文里没有对等概念，不属于漏译（详见 web/i18n.dict.js 顶部说明）。
//
// 用法：
//   node tools/verify-i18n.js              # 断言模式：en 态有白名单外中文就 exit 1
//   node tools/verify-i18n.js --list       # 只列出扫到的中文，不做判定（用来更新白名单）
//   node tools/verify-i18n.js --shots      # 顺便存几张截图到 /tmp/i18n-shots/
//
// ⚠️ 需要本地服务已经在跑（读项目根的 .port，兜底 8799）。
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MODE_LIST = process.argv.includes('--list');
const SHOTS = process.argv.includes('--shots') || process.argv.includes('--list');
const SHOT_DIR = '/tmp/i18n-shots';

const LOG = '/tmp/verify-i18n.log';
const CHROME_ERR = '/tmp/verify-i18n.chrome.err';
try { fs.unlinkSync(LOG); } catch (e) {}
// 同步写日志：process.exit / SIGKILL 时管道里的 stdout 会整段丢，必须落盘兜底
const out = s => { fs.writeSync(1, s + '\n'); fs.appendFileSync(LOG, s + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 端口 ────────────────────────────────────────────────────────────────────
let PORT = 8799;
try { PORT = Number(fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim()) || PORT; } catch (e) {}
const BASE = `http://127.0.0.1:${PORT}`;

// ── 要巡检的页面（顺序＝左侧导航 .navi 的下标）───────────────────────────────
const PAGES = [
  { i: 0, key: 'analysis', zh: '抽卡分析', en: 'Warp Analysis' },
  { i: 1, key: 'roles', zh: '角色管理', en: 'Characters' },
  { i: 2, key: 'divination', zh: '八卦占卜', en: 'Divination' },
  { i: 3, key: 'data', zh: '抓取与数据管理', en: 'Fetch & Data' },
  { i: 4, key: 'help', zh: '解释说明', en: 'Guide' },
];

// ── 内容层白名单（刻意保留的中文）───────────────────────────────────────────
// 每项 = 一个正则，匹配「文本节点所在的 class 串」。命中即视为有意保留的中文。
// 维护方式：改动占卜/黄历相关模板后跑 --list，看有没有新条目，再决定是补词条还是加白名单。
const EXPECT = [
  // 语言切换器：语言名按各自母语显示（中文 / English），本来就不该翻译
  /lg-native/,
  // 卦名汉字（英译只作对照附注，汉字是本体）＋ 罗盘里承载卦名的 SVG <text> 节点
  // （SVG 元素的 className 是 SVGAnimatedString，采集侧退回 tagName，所以这里按 tagName 精确匹配）
  /dz-gname/,
  /^text$/,
  // 卦辞 / 爻辞 / 象曰 / 彖传 / 杂卦传 / 小象 / 变卦爻辞 的原文与注疏
  /dz-ci|dz-xiang|dz-xs\b|dz-var|dz-gsym|gua|dz-sol|dz-notes|dz-jy/,
  // 吉/中/凶 关键词、择时打分依据、档位说明
  /dz-kw|dz-slim|dz-doc|dz-lv|dz-zt-seg|dz-almanac|dz-alm/,
  // 卦象档位名（大吉/吉/…）与时机阶梯说明里的卦名
  /dz-badge|dz-tip|dz-note|dz-warn|dz-mini/,
  // ── 万年历内容层（黄历术语：干支 / 建除十二神 / 二十八宿 / 神煞 / 宜忌 / 时辰）──
  //    与「择时打分依据」同一口径，刻意保留中文。**这里按区域容器收口，不按散落的 td/an> class**，
  //    否则 whitelist 会变成「什么都放行」。下列 class 都是这些区域专属的：
  /dz-mk/,                     // 黄历标记（执日·吉 / 忌开市 / 吉神 5：…）
  /dz-more/,                   // 打分依据 / 其余 N 天 / 逐爻明细 等折叠区
  /dz-rgt|dz-zt-tbl/,          // 择日榜、时辰榜两张表
  /dz-zt-yiji|dz-zt-best/,     // 日宜忌块、最佳时辰卡
  /dz-zt-top/,                 // 今日吉时卡的日家信息（农历 / 干支 / 建除 / 星宿 / 神煞 / 此刻时辰）
  /dz-coin|dz-zi|dz-bei/,      // 铜钱两面的字（正面「星穹宝通」/ 背面「背」）
  // 出金吉凶徽章与它的短注（analysis 页，内容同「万年历内容层」）
  /jxb|jxt/,
];

// ── 与页面通信的小工具 ──────────────────────────────────────────────────────
const D = '\u0001';   // 采集结果的字段分隔符（避开文本里可能出现的字符）
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
void sleepMs;

async function main() {
  const dbg = 9400 + Math.floor(Math.random() * 90);
  const profile = '/tmp/verify-i18n-prof-' + dbg;
  out('· 起无头 Chrome dbg=' + dbg);
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--in-process-gpu', '--no-sandbox',
    '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-proxy-server',
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + dbg, '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const errFd = fs.openSync(CHROME_ERR, 'w');
  chrome.stderr.on('data', d => fs.writeSync(errFd, d));
  chrome.stdout.on('data', () => {});
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', cleanup);
  process.on('uncaughtException', e => { out('!! ' + (e && e.stack || e)); cleanup(); process.exit(1); });

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
      target = list.find(t => t.type === 'page');
    } catch (e) { /* 端口还没起来 */ }
  }
  if (!target) throw new Error('拿不到调试端口上的 page target（Chrome 起不来或端口被占）');
  out('· 已连上 target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error('ws: ' + e.message)); });
  let seq = 0;
  const pend = new Map();
  const jsErrs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = (m.params.exceptionDetails || {});
      jsErrs.push((d.text || '') + ' @' + ((d.url || '').split('/').pop()) + ':' + (d.lineNumber + 1));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      jsErrs.push('log: ' + m.params.entry.text);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pend.set(id, m => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  // 每个 CDP 步骤都套超时：Chrome 崩掉时 promise 永不 resolve，node 会静默退出（exit 0）
  const step = async (label, p, ms) => Promise.race([
    Promise.resolve().then(() => p),
    sleep(ms || 20000).then(() => { throw new Error('超时 ' + (ms || 20000) + 'ms ← ' + label); }),
  ]);
  const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;

  await step('Runtime.enable', send('Runtime.enable'));
  await step('Page.enable', send('Page.enable'));
  await step('Log.enable', send('Log.enable'));

  // ── 采集表达式：遍历文本节点，把含中文的连 class 一起吐出来 ──────────────
  // ⚠️ 注入串会在模板字符串里过一层转义，所以**不写撇号正则**，用码点判断代替
  const COLLECT = `(function () {
    var isCJK = function (ch) { var p = ch.codePointAt(0); return p >= 0x3400 && p <= 0x9FFF; };
    var res = [];
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = w.nextNode())) {
      var s = n.nodeValue;
      if (!s) continue;
      var hit = false;
      for (var i = 0; i < s.length; i++) { if (isCJK(s.charAt(i))) { hit = true; break; } }
      if (!hit) continue;
      var el = n.parentElement;
      var cls = el ? (typeof el.className === 'string' ? el.className : el.tagName) : '?';
      var pth = [];
      var cur = el;
      while (cur && cur !== document.body) {
        // ⚠️ 取**全部** class（用 . 连），不能只取第一个：多 class 容器
        //    （<table class="dz-tbl dz-zt-tbl">）只留 dz-tbl 的话，白名单按区域匹配就永远不中。
        var c = (typeof cur.className === 'string' ? cur.className : '').split(/\\s+/).filter(Boolean).join('.');
        if (c) pth.unshift(c);
        cur = cur.parentElement;
      }
      res.push(cls + ${JSON.stringify(D)} + pth.join('>') + ${JSON.stringify(D)} + s.trim().slice(0, 90));
    }
    return JSON.stringify(res);
  })()`;

  const setLang = async lang => {
    await ev(`try { localStorage.setItem('sr.lang', ${JSON.stringify(lang)}); } catch (e) {}`);
    await step('reload', send('Page.reload', { ignoreCache: true }), 25000);
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      const ok = await ev(`document.readyState === 'complete' && document.querySelectorAll('.navi').length >= 5`);
      if (ok) break;
    }
    await sleep(900);
  };

  const gotoChip = async idx => {
    await ev(`(function(){ var b = document.querySelectorAll('.navi')[${idx}]; if (b) b.click(); return !!b; })()`);
    await sleep(700);
    // 整页扫滚：懒加载图片不滚不解码，会让「图片全挂」的假失败出现
    await ev(`(async function(){
      var h = document.body.scrollHeight;
      for (var y = 0; y < h; y += 650) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 90)); }
      window.scrollTo(0, 0);
      return 1;
    })()`);
    await sleep(1200);
  };

  const grab = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  const shot = async name => {
    if (!SHOTS) return;
    try {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await grab(name);
      // 再滚到底拍一张：英文标签普遍更长，长表格与长文的下半部分才看得到。
      // ⚠️ 别用 captureBeyondViewport 截整页 —— 解释说明页一万多像素高，
      //    CDP 会直接挂住（实测 5 分半不返回），比多滚动一次麻烦得多。
      await ev('window.scrollTo(0, document.body.scrollHeight)');
      await sleep(700);
      await grab(name + '-b');
      await ev('window.scrollTo(0, 0)');
      await sleep(150);
    } catch (e) { out('  (截图失败 ' + name + ': ' + e.message + ')'); }
  };

  // ── 主流程 ────────────────────────────────────────────────────────────────
  await step('navigate', send('Page.navigate', { url: BASE + '/' }), 25000);
  const probe = await fetch(BASE + '/').then(r => r.status).catch(() => 0);
  out('· 服务探活 http=' + probe + ' @ ' + BASE);
  if (probe !== 200) throw new Error('本地服务没起来，先在项目根跑一次启动器');

  const report = {};
  for (const lang of ['zh', 'en']) {
    await setLang(lang);
    report[lang] = {};
    for (const p of PAGES) {
      await gotoChip(p.i);
      const raw = await ev(COLLECT);
      let rows = [];
      try { rows = JSON.parse(raw || '[]'); } catch (e) { throw new Error(p.key + ' 采集结果解析失败: ' + String(raw).slice(0, 120)); }
      const items = rows.map(r => { const a = r.split(D); return { cls: a[0], path: a[1], txt: a[2] }; });
      report[lang][p.key] = items;
      await shot(lang + '-' + p.key);
      out('  ' + lang + ' ' + p.key.padEnd(11) + ' 含中文文本节点: ' + items.length);
    }
  }

  // ── 判定 ──────────────────────────────────────────────────────────────────
  const isAllowed = it => EXPECT.some(re => re.test(it.cls) || re.test(it.path));
  let bad = [];
  for (const p of PAGES) {
    const items = report.en[p.key] || [];
    const leftovers = items.filter(it => !isAllowed(it));
    if (leftovers.length) bad.push({ page: p.key, leftovers });
  }

  out('');
  if (MODE_LIST) {
    out('── en 态含中文的文本节点（未过滤）──────────────────────────────');
    for (const p of PAGES) {
      const items = report.en[p.key] || [];
      if (!items.length) continue;
      out('[' + p.key + '] ' + items.length + ' 条');
      const seen = new Set();
      for (const it of items) {
        const k = it.cls + '|' + it.txt;
        if (seen.has(k)) continue;
        seen.add(k);
        out('   ' + (isAllowed(it) ? '· ok  ' : '! bad ') + it.cls.slice(0, 34).padEnd(34) + ' | ' + it.txt);
      }
    }
    out('');
    out('zh 态节点数（口径自检，应远多于 en）：' + PAGES.map(p => p.key + '=' + (report.zh[p.key] || []).length).join(' '));
  }

  if (jsErrs.length) {
    out('⚠️ 页面 JS 报错 ' + jsErrs.length + ' 条：');
    [...new Set(jsErrs)].slice(0, 10).forEach(e => out('   ' + e));
  } else {
    out('✓ 页面无 JS 报错');
  }

  if (bad.length && !MODE_LIST) {
    out('');
    out('✗ en 态仍有 ' + bad.reduce((a, b) => a + b.leftovers.length, 0) + ' 处非内容层中文：');
    for (const b of bad) {
      out('  [' + b.page + ']');
      const seen = new Set();
      for (const it of b.leftovers) {
        const k = it.cls + '|' + it.txt;
        if (seen.has(k)) continue;
        seen.add(k);
        out('    ' + (it.cls || '(无 class)').slice(0, 26).padEnd(26)
          + ' ‹' + it.path.slice(-48) + '› | ' + it.txt);
      }
    }
  }

  out('');
  out('日志: ' + LOG + ' · Chrome stderr: ' + CHROME_ERR + (SHOTS ? ' · 截图: ' + SHOT_DIR : ''));

  ws.close();
  cleanup();
  if (bad.length && !MODE_LIST) { process.exitCode = 1; }
}

main().catch(e => { out('!! ' + (e && e.stack || e)); process.exitCode = 1; });
