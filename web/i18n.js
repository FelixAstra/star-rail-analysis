// ─────────────────────────────────────────────────────────────────────────────
// 崩铁抽卡分析平台 · 双语层（zh-CN / en-US）
//
// 设计（照抄主题切换的既有模式，零构建、零依赖）：
//   · 语言存 localStorage（key: sr.lang），默认 zh；
//   · t(原文[, 参数]) —— **以中文原文为 key** 的 msgid 式字典：
//       - zh 模式直接返回原文（不查字典，天然零漏译）；
//       - en 模式查 DICT，查不到回退原文（宁可露中文，也不露空串）；
//   · n(中文名) —— 角色 / 光锥**官方英文名**：按 id 把 StarRailRes 的
//     cn 索引与 en 索引对齐建映射（en 索引即米哈游官方英文本地化，不是自译）；
//   · L(中文, 英文) —— 引擎产出成对文案时二选一（如统计卡的 key/sub）；
//   · 持久化 + <html data-lang> 属性（en 模式下的排版微调靠它，见 styles.css）。
//
// ⚠️ 占卜内容层（卦辞 / 爻辞 / 白话释义 / 黄历宜忌 / 择时打分依据）**不翻译**：
//    周易原文与黄历术语在英文里没有对等概念，保留原文反而是这一页的特色。
//    要翻译的只是结构性 UI（按钮 / 表头 / 段落标题 / 口径与免责清单）。
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const W = window.W = window.W || {};
  const { ref } = Vue;

  const LANG_KEY = 'sr.lang';
  const LANGS = ['zh', 'en'];
  const readLang = () => {
    try { const v = localStorage.getItem(LANG_KEY); return LANGS.indexOf(v) >= 0 ? v : 'zh'; }
    catch (e) { return 'zh'; }
  };

  const lang = ref(readLang());

  // 标签页标题：<title> 是 HTML 静态节点，切语言时得跟着换（不换会中英不一致）
  const TITLES = { zh: '崩铁抽卡分析工作台', en: 'Honkai: Star Rail Warp Analysis' };

  function applyLang() {
    const h = document.documentElement;
    h.setAttribute('data-lang', lang.value);
    h.setAttribute('lang', lang.value === 'en' ? 'en' : 'zh-CN');
    try { document.title = TITLES[lang.value] || TITLES.zh; } catch (e) { /* 极老的浏览器忽略即可 */ }
  }
  function setLang(k) {
    if (LANGS.indexOf(k) < 0) return;
    lang.value = k;
    try { localStorage.setItem(LANG_KEY, k); } catch (e) { /* 隐私模式写不进去，不影响切换 */ }
    applyLang();
  }
  applyLang();

  // ── 字典（en）─────────────────────────────────────────────────────────────
  // key = 界面里的中文原文。zh 模式不查表，所以词条只在 web/i18n.dict.js 里放 en。
  // ⚠️ i18n.dict.js 必须**先于**本文件加载（index.html 已按序排好）；
  //    万一没加载到，这里退化成空表 → en 模式全部回退中文，不会白屏。
  const DICT = W.DICT_EN || {};
  W.DICT = DICT;   // 供 tools/check-i18n.js 做覆盖率校验（CI 里跑）

  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // {x} 占位符替换：**占位值一律转义**（模板本身可以带 <b>/<code> 等标记）
  function subst(s, params) {
    return String(s).replace(/\{(\w+)\}/g, (m, k) =>
      (params && params[k] != null) ? esc(params[k]) : m);
  }

  function t(key, params) {
    const v = (lang.value === 'en' && DICT[key] != null) ? DICT[key] : key;
    return params ? subst(v, params) : v;
  }
  // 引擎成对文案二选一（en 缺失时回退中文）
  function L(zh, en) { return (lang.value === 'en' && en != null && en !== '') ? en : zh; }

  // ── 角色 / 光锥官方英文名 ─────────────────────────────────────────────────
  // en 索引（assets/index/en_*.json）= StarRailRes 收录的官方英文本地化。
  // ⚠️ 异步装载：没装载完之前先显示中文名，装好后 nVer 触发一次全页重渲染。
  const N2E = {};
  const nVer = ref(0);
  (async function loadNames() {
    try {
      const get = f => fetch('/assets/index/' + f).then(r => r.json());
      const [cnC, enC, cnL, enL] = await Promise.all([
        get('cn_characters.json'), get('en_characters.json'),
        get('cn_light_cones.json'), get('en_light_cones.json'),
      ]);
      for (const [cn, en] of [[cnC, enC], [cnL, enL]]) {
        Object.keys(en).forEach(id => { if (cn[id]) N2E[cn[id].name] = en[id].name; });
      }
      nVer.value++;
    } catch (e) { /* 索引还没下载过（全新克隆）：名字先按中文显示 */ }
  })();
  function n(name) { void nVer.value; return (lang.value === 'en' && N2E[name]) ? N2E[name] : name; }

  // ── 卦名英译对照（64 卦 · Legge / Wilhelm 通行译名，仅作对照附注） ────────
  // 原文（卦名 / 卦辞 / 爻辞）不翻译；这里只给一个通行的英文名帮助检索文献。
  const GUA_EN = {
    '乾': 'The Creative', '坤': 'The Receptive', '屯': 'Difficulty at the Beginning',
    '蒙': 'Youthful Folly', '需': 'Waiting', '讼': 'Conflict', '师': 'The Army',
    '比': 'Holding Together', '小畜': 'The Taming Power of the Small', '履': 'Treading',
    '泰': 'Peace', '否': 'Standstill', '同人': 'Fellowship', '大有': 'Possession in Great Measure',
    '谦': 'Modesty', '豫': 'Enthusiasm', '随': 'Following', '蛊': 'Work on the Decayed',
    '临': 'Approach', '观': 'Contemplation', '噬嗑': 'Biting Through', '贲': 'Grace',
    '剥': 'Splitting Apart', '复': 'Return', '无妄': 'Innocence',
    '大畜': 'The Taming Power of the Great', '颐': 'Nourishment',
    '大过': 'Preponderance of the Great', '习坎': 'The Abysmal (Water)', '离': 'The Clinging (Fire)',
    '咸': 'Influence', '恒': 'Duration', '遁': 'Retreat', '大壮': 'The Power of the Great',
    '晋': 'Progress', '明夷': 'Darkening of the Light', '家人': 'The Family',
    '睽': 'Opposition', '蹇': 'Obstruction', '解': 'Deliverance', '损': 'Decrease',
    '益': 'Increase', '夬': 'Breakthrough', '姤': 'Coming to Meet',
    '萃': 'Gathering Together', '升': 'Pushing Upward', '困': 'Oppression',
    '井': 'The Well', '革': 'Revolution', '鼎': 'The Cauldron', '震': 'Arousing (Thunder)',
    '艮': 'Keeping Still', '渐': 'Development', '归妹': 'The Marrying Maiden',
    '丰': 'Abundance', '旅': 'The Wanderer', '巽': 'The Gentle (Wind)',
    '兑': 'The Joyous (Lake)', '涣': 'Dispersion', '节': 'Limitation',
    '中孚': 'Inner Truth', '小过': 'Preponderance of the Small',
    '既济': 'After Completion', '未济': 'Before Completion',
  };
  function guaEn(name) { return (lang.value === 'en' && GUA_EN[name]) ? GUA_EN[name] : ''; }

  W.I18N = { lang, setLang, t, L, n, guaEn, GUA_EN, LANGS };
})();
