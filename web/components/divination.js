// ─────────────────────────────────────────────────────────────────────────────
// 「八卦占卜」页 —— 三枚铜钱 × 龟壳 × 万年历
//
// 分工：**所有判断都在 core/divination.js 里算完**（起卦、变占取用、吉凶、时机区间、
// 万年历），本文件只负责「把仪式演出来 + 把 JSON 摊开给人看」。所以这里没有任何
// 概率或卦理逻辑，改数字不会绕过引擎的断言。
//
// 动画：纯 CSS keyframes + JS 设 transform，不引任何库，也不引任何图片素材
//       （龟壳与铜钱都是 SVG / CSS 画的，避免素材版权问题）
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const W = window.W = window.W || {};

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // 要等两帧才能让「无过渡 → 有过渡」的样式变更被浏览器采纳（只等一帧会偶发动画不触发）
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  // 后天八卦（文王八卦）方位：南上、北下、东左、西右
  const BAGUA = [
    { n: '离', g: '☲', deg: 0 }, { n: '坤', g: '☷', deg: 45 },
    { n: '兑', g: '☱', deg: 90 }, { n: '乾', g: '☰', deg: 135 },
    { n: '坎', g: '☵', deg: 180 }, { n: '艮', g: '☶', deg: 225 },
    { n: '震', g: '☳', deg: 270 }, { n: '巽', g: '☴', deg: 315 },
  ];
  const TRIGRAM = { 乾: '☰', 兑: '☱', 离: '☲', 震: '☳', 巽: '☴', 坎: '☵', 艮: '☶', 坤: '☷' };
  // 十二时辰自然序：接口给回来的吉时榜是按分数排的，画时序条要用自然序
  const ZHI_ORDER = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  // 铜钱的落点（百分比，相对桌面）：三枚散在桌面下半部。
  // ⚠️ 罗盘上八个卦名画在半径 41% 处，铜钱斜躺后的外接半径约 6.6% →
  //    落点离盘心的距离必须 ≤ 30%，否则会压住「艮」「乾」的卦名（曾压住过）。
  const SLOTS = [{ x: 33, y: 66 }, { x: 50, y: 74 }, { x: 67, y: 66 }];
  // 龟壳停在「上卦位」：30% 是让开顶部「离」字的极限位置，再往上就压字了。
  const SHELL = { x: 50, y: 30 };

  // ── 龟腹甲几何 ─────────────────────────────────────────────────────────────
  // ⚠️ 商周占卜用的是**腹甲**（扁平、左右对称、中间一条纵缝），不是背甲穹顶。
  //    旧版画的是「椭圆 + 蜂巢盾片」，那是背甲，而且蜂巢是臆造的纹路。
  //    现在按真腹甲重画：颈凹缺口 / 千里路 / 内腹甲菱形 / 骨缝 / 齿缝 / 钻凿 / 灼兆。
  //    viewBox 132 × 106，中心 (66,53)。纯 SVG，不引任何图片素材。
  const PW = 132, PH = 106;

  // 轮廓：上缘宽、中央有「颈凹」（头颈伸出处），两侧外弧，下收成剑腹甲
  const P_OUTLINE =
    'M66,11.5 C72,7 82,6 90,8.5 C104,11.5 117,20 122,34 C127,49 125,65 116,77 '
    + 'C106,90 88,98.5 66,98.5 C44,98.5 26,90 16,77 C7,65 5,49 10,34 '
    + 'C15,20 28,11.5 42,8.5 C50,6 60,7 66,11.5 Z';

  // 千里路（中缝）被「内腹甲」菱形中断 —— 内腹甲是单块不成对的板，
  // 所以中缝只有它上方一小段 + 下方一长段。这是真结构，不是画漏。
  const P_QIANLI_TOP = 'M66,12.6 C65.4,15 65.6,17.5 66,20';
  const P_QIANLI_BOT = 'M66,43 C64.8,58 67.2,78 66,96.5';
  const P_ENTO = 'M66,20 L82.4,30.4 L66,43 L49.6,30.4 Z';

  // 骨缝（鳞缝）：四条，左右各一条从壳缘走到中缝
  const P_SEAMS = [
    ['M11,35 C30,31.6 49,31 66,32.6', 'M121,35 C102,31.6 83,31 66,32.6'],
    ['M6.4,52 C27,48.6 48,48 66,49.6', 'M125.6,52 C105,48.6 84,48 66,49.6'],
    ['M8.6,70 C29,66.6 49,66 66,67.6', 'M123.4,70 C103,66.6 83,66 66,67.6'],
    ['M21,86.6 C37,83.6 53,83 66,84.4', 'M111,86.6 C95,83.6 79,83 66,84.4'],
  ];

  // 钻凿：背面先钻圆孔、再凿长槽，成对竖排。正面看到的是「透痕」（深色凹点）。
  // 左右各两列 × 四行 —— 真甲上的钻凿本就是成排的，不是随手撒点。
  const P_ZUO = (function () {
    const out = [];
    [66 - 25, 66 - 13, 66 + 13, 66 + 25].forEach(x => {
      [26, 41, 58, 74].forEach(y => out.push([x, y]));
    });
    return out;
  })();

  // 灼兆：「卜」字形裂纹 —— 兆干（近平直的主裂）+ 兆枝（从干上斜分的支裂）。
  // 龟卜看的就是这个；在本页里只作器物纹样（见页面口径第 11 条）。
  const P_ZHAO = [
    { gan: 'M39,28 L39.6,55', zhi: ['M39,35.5 L31,29.5', 'M39.3,46 L31.6,41.5'], hot: [39, 36] },
    { gan: 'M49.6,64 L50,88', zhi: ['M49.7,71 L57,65.5'], hot: [49.8, 71] },
    { gan: 'M93,28 L92.4,55', zhi: ['M93,35.5 L101,29.5', 'M92.7,46 L100.4,41.5'], hot: [93, 36] },
    { gan: 'M82.4,64 L82,88', zhi: ['M82.3,71 L75,65.5'], hot: [82.2, 71] },
  ];

  // 齿缝：壳缘内侧一圈短刻线
  const P_RIM = (function () {
    const out = [];
    for (let i = 0; i < 44; i++) {
      const t = i / 44 * Math.PI * 2;
      out.push([
        (66 + 57 * Math.cos(t)).toFixed(1), (53 + 47 * Math.sin(t)).toFixed(1),
        (66 + 50.5 * Math.cos(t)).toFixed(1), (53 + 40.5 * Math.sin(t)).toFixed(1),
      ]);
    }
    return out;
  })();

  // 摇卦时三枚钱在壳内的散布（百分比，相对舞台）—— 不能全堆在同一点，否则看着像一枚
  const SHELL_RATTLE = [[-1.8, 0.6], [0.4, -1.1], [1.9, 0.9]];

  // 有「当期限定」概念的池（角色/光锥活动 + 联动）——
  // 常驻池与新手池是「出金即达成」，不需要 UP 线，也不需要问保底状态
  const UP_GTS = ['11', '12', '21', '22'];

  W.DivinationPage = {
    props: { a: Object },
    inject: ['goto'],
    data() {
      return {
        phase: 'idle',            // idle | shake | throw | done
        tip: '静心默念所求，再点「开始摇卦」',   // 展示时经 t()：切换语言跟着变
        coins: [0, 1, 2].map(() => ({ tf: '', tr: 'none', op: 0, face: null })),
        done: [],                 // 已落定的爻，index 0 = 初爻
        result: null,
        err: '',
        gt: '11',
        method: 'coin',           // coin 三枚铜钱法 / yarrow 大衍揲蓍法
        upMode: 'small',          // small 小保底 / big 大保底 —— 只影响「出金即当期」的概率
        skip: false,
        stage: { w: 520, h: 520 },
        bagua: BAGUA,
        trigram: TRIGRAM,
        shell: SHELL,             // 龟壳锚点（与掷钱起点共用，靠 data 下发避免 CSS 与 JS 各写一份）
        rattle: SHELL_RATTLE,     // 摇卦时三枚钱在壳内的散布
        shellGeo: {               // 龟腹甲几何（静态，模板只读）
          w: PW, h: PH, outline: P_OUTLINE,
          qianliTop: P_QIANLI_TOP, qianliBot: P_QIANLI_BOT, ento: P_ENTO,
          // ⚠️ 全部摊平成一维数组：SVG 里不出现 <template v-for>，
          //    避免 Vue 在 SVG 命名空间下处理 fragment 的边界情况
          seams: P_SEAMS.reduce((a, p) => a.concat(p), []),
          zuo: P_ZUO, rim: P_RIM,
          zhaoGan: P_ZHAO.map(z => z.gan),
          zhaoZhi: P_ZHAO.reduce((a, z) => a.concat(z.zhi), []),
          zhaoHot: P_ZHAO.map(z => z.hot),
        },
        settling: false,          // 摇完落定的那一下弹跳
        detailOpen: false,
        zeri: null,               // 今日择时（进页就有，不必先摇卦）
        zeriErr: '',
        banner: null,             // 当期卡池日历（第三方源；全平台唯一联网点）
        bannerErr: '',
        range: null,              // 当期卡池剩余期内的择日榜（日家择吉）
        rangeErr: '',
        rangeCut: null,           // 择日区间的截断信息（关池时刻 / 到期日是不是整天）
      };
    },
    computed: {
      pools() {
        const b = (this.a && this.a.poolBounds) || [];
        return b.map(p => ({
          gt: String(p.gt), label: this.t(this.a.poolShort[p.gt] || p.gt) + this.t('池'),
          cur: p.cur, hard: p.hard, unique: UP_GTS.indexOf(String(p.gt)) !== -1,
        }));
      },
      curPool() { return this.pools.find(p => p.gt === this.gt) || null; },
      // 当期卡池：取引擎**合并后**的期次（合并后才带 UP 角色/光锥名单）
      bnTerm() { return (this.banner && this.banner.currentTerm) || null; },
      // 开池时刻是否被本地抽卡记录校准过 —— 数据源给的 start 偏 +7 小时，
      // 只有校准过的才敢直接显示（见 core/banner.js 文件头）
      bnCalibrated() {
        const l = (this.banner && this.banner.list) || [], t = this.bnTerm;
        if (!t) return false;
        return l.some(x => x.startFrom === 'local'
          && String(x.start).slice(0, 10) === String(t.start).slice(0, 10));
      },
      busy() { return this.phase === 'shake' || this.phase === 'throw'; },
      timing() { return (this.result && this.result.timing) || null; },
      headline() { return (this.timing && this.timing.headline) || null; },
      // 两条单点线：出金线（任何 5★）与 UP 线（当期限定）
      lines() {
        const t = this.timing;
        if (!t) return [];
        const out = [{
          key: 'gold', name: '出金线', tag: '任何 5★',
          at: t.gold.at, draws: t.gold.draws, chance: t.gold.chance, reached: true,
          main: (t.headline || {}).kind === 'gold',
        }];
        if (t.unique) out.push({
          key: 'up', name: 'UP 线', tag: '当期限定',
          at: t.upLine.at, draws: t.upLine.draws, chance: t.upLine.chance,
          reached: t.upLine.reached, maxChance: t.upLine.maxChance,
          main: (t.headline || {}).kind === 'up',
        });
        return out;
      },
      plat() { return (this.stage.w + this.stage.h) / 2 / 100; },   // 百分比 → 像素的换算基准
      // 六爻按上→下显示（初爻在最下面）
      hexRows() {
        const rows = [];
        for (let i = 5; i >= 0; i--) rows.push(this.done[i] || { empty: true, i });
        return rows;
      },
      // 吉时榜按时辰自然序（子丑寅…亥）铺成时序条
      ztOrder() {
        if (!this.zeri) return [];
        return ZHI_ORDER.map(k => (this.zeri.hours || []).find(h => h.zhi === k)).filter(Boolean);
      },
      nowHour() {
        if (!this.zeri || !this.zeri.now) return null;
        return (this.zeri.hours || []).find(h => h.zhi === this.zeri.now.zhi) || null;
      },
      bestHour() { return (this.zeri && this.zeri.best) || null; },
      // 榜首「为什么」——时家天神本身已经单独写在榜单里，这里只拼「另外的理由」，避免重复
      bestWhy() {
        const b = this.bestHour;
        if (!b) return '';
        return b.marks.filter(m => m.dim !== '时家天神').map(m => m.tag).join(' · ');
      },
      // 双曲线：出金把握 + 拿 UP 把握（两条 path，模板里各画一条）
      curve() {
        const c = this.timing && this.timing.curve;
        if (!c || !c.length) return null;
        const w = 320, h = 72;
        const x = i => (i / Math.max(1, c.length - 1)) * w;
        const y = v => h - Math.max(0, Math.min(1, v)) * h;
        const path = key => c.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d[key]).toFixed(1)).join(' ');
        return { w, h, p: path('p'), u: path('u') };
      },
      curveW() { return 320; },
      curveH() { return 72; },
    },
    // 切卡池 / 切保底状态时**不动卦象**，只把推演重算一遍 ——
    // 卦是摇出来的，不该因为换了个池就被重摇；而抽数本来只依赖池与保底状态。
    // （起卦法不在 watch 里：它管的是「下次怎么摇」，拿旧爻去重算只会换个标签。）
    watch: {
      gt() { this.recompute(); },
      upMode() { this.recompute(); },
    },
    mounted() {
      this.measure();
      this.loadZeri();
      this.loadBanner();   // 卡池日历是页面唯一的联网请求；失败不影响其余离线功能
      // ⚠️ 必须挂在 window 上：Options API 的 this 是组件代理，没有 addEventListener
      window.addEventListener('resize', this.measure);
    },
    beforeUnmount() { window.removeEventListener('resize', this.measure); },
    methods: {
      measure() {
        const el = this.$refs.stage;
        if (el && el.clientWidth) this.stage = { w: el.clientWidth, h: el.clientHeight || el.clientWidth };
      },
      px(dx, dy) { return [dx * this.plat, dy * this.plat]; },

      // 今日吉时：与摇卦解耦 —— 进页面先看时辰，再决定要不要摇卦
      loadZeri() {
        this.zeriErr = '';
        fetch('/api/zeri').then(r => r.json())
          .then(r => { if (r && r.ok) this.zeri = r; else this.zeriErr = (r && r.error) || W.I18N.t('择时服务未就绪'); })
          .catch(e => { this.zeriErr = String((e && e.message) || e); });
      },

      // 当期卡池日历：自动获取 + 本地记录校准。取不到就只提示，不阻断页面
      loadBanner() {
        this.bannerErr = '';
        fetch('/api/banner').then(r => r.json())
          .then(r => {
            if (!r || !r.ok) { this.bannerErr = (r && r.error) || W.I18N.t('卡池日历未就绪'); return; }
            this.banner = r;
            this.loadRange();
          })
          .catch(e => { this.bannerErr = String((e && e.message) || e); });
      },

      // 剩余期内的择日榜：区间只到当期卡池**最后一个完整日**为止。
      // ⚠️ 卡池到期那天只开到 HH:MM（常见 03:59），之后的时辰早就没池子了 ——
      //    不处理就会把「9-28 午时」排成第一名，而那天的午时根本抽不了。
      loadRange() {
        const t = this.bnTerm;
        if (!t) return;
        this.rangeErr = '';
        const endStr = String(t.end);          // '2026-09-28 03:59'
        const last = endStr.slice(0, 10);
        const today = this.todayStr();
        let to = last;
        // 23:00 之后才关，才算「一整天都在开」；否则退到前一天
        if (last > today && endStr.slice(11, 16) < '23:00') to = this.dayBefore(last);
        if (to < today) to = today;            // 到期日就是今天时，至少把今天排进来
        this.rangeCut = { end: endStr, partial: to !== last, to };
        fetch('/api/zeri/range?to=' + encodeURIComponent(to)).then(r => r.json())
          .then(r => { if (r && r.ok) this.range = r; else this.rangeErr = (r && r.error) || W.I18N.t('择日服务未就绪'); })
          .catch(e => { this.rangeErr = String((e && e.message) || e); });
      },
      todayStr() {
        const n = new Date();
        return [n.getFullYear(), String(n.getMonth() + 1).padStart(2, '0'),
          String(n.getDate()).padStart(2, '0')].join('-');
      },
      // 基准取**正午**再减一天：任何时区偏移都不会把日期挪过头
      dayBefore(s) {
        const d = new Date(s + 'T12:00:00+08:00');
        d.setDate(d.getDate() - 1);
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong',
          year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      },

      // 引擎的文案沿用 `**重点**` 标粗（源文件是可读的 markdown 风格），这里转成 <b>。
      // ⚠️ 必须先转义再替换：否则数据里万一出现 < 就会被当成标签。内容全部来自本仓库，
      //    不含任何用户输入，所以 v-html 是安全的。
      bold(s) {
        const esc = String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return esc.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      },

      // 爻的吉/中/凶标签（384 爻全部有据，来自开源数据集）
      luckTx(l) {
        if (!l) return '—';
        const t = l.label > 0 ? '吉' : l.label < 0 ? '凶' : '中';
        const tx = W.I18N.t(t);   // 吉/中/凶 → Auspicious / Neutral / Ominous（关键词保留原文）
        return (l.kw && l.kw.length) ? tx + ' · ' + l.kw.slice(0, 2).join('') : tx;
      },
      luckCls(l) { return !l ? 'lv-p' : (l.label > 0 ? 'lv-j2' : (l.label < 0 ? 'lv-x1' : 'lv-p')); },
      dgCls(d) { return 'dg-' + ((d && d.level) || 'd0'); },

      // 用**同一副卦**重新推演（把当前六爻原样回传给引擎）
      // ⚠️ 回填前再确认一次 result 还在 —— 用户可能在请求飞行途中点了「重新起卦」，
      //    那种情况下这次响应必须丢弃，否则卦会被「复活」。
      async recompute() {
        if (!this.result || !this.result.rolls) return;
        const lines = this.result.rolls.map(r => r.value).join(',');
        try {
          const r = await fetch('/api/divination?gt=' + encodeURIComponent(this.gt)
            + '&upMode=' + encodeURIComponent(this.upMode)
            + '&method=' + encodeURIComponent(this.method)
            + '&lines=' + lines).then(x => x.json());
          if (r && r.ok && this.result) this.result = r;
        } catch (e) { /* 网络抖动就保持旧结果，不打断看卦 */ }
      },

      // 把铜钱放到某处；mode: 'jump' 瞬移 · 'back' 快速收回 · 'drop' 正常落下
      place(i, dx, dy, rotY, rotZ, op, mode) {
        const [x, y] = this.px(dx, dy);
        const c = this.coins[i];
        c.tr = mode === 'jump' ? 'none'
          : mode === 'back' ? 'transform .2s ease-in, opacity .12s'
            : 'transform .42s cubic-bezier(.2,.62,.36,1), opacity .2s';
        c.op = op;
        c.tf = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotateX(0deg) rotateY(${rotY}deg) rotateZ(${rotZ}deg)`;
      },

      async start() {
        if (this.phase === 'shake' || this.phase === 'throw') return;
        this.result = null; this.err = ''; this.done = []; this.skip = false;
        this.measure();

        // ① 先起卦（后端），动画同时开始 —— 别等网络回来才开始演
        const p = fetch('/api/divination?gt=' + encodeURIComponent(this.gt)
          + '&method=' + encodeURIComponent(this.method)
          + '&upMode=' + encodeURIComponent(this.upMode))
          .then(r => r.json()).catch(e => ({ ok: false, error: String(e && e.message || e) }));

        // ② 摇壳：三枚钱散在壳内各自抖（全堆在同一点会看成只有一枚）
        this.phase = 'shake';
        this.tip = '摇动龟壳，静候卦成 …';
        for (let i = 0; i < 3; i++) {
          const r = SHELL_RATTLE[i];
          this.place(i, SHELL.x + r[0], SHELL.y + r[1], i * 60, i * 35, 1, 'jump');
        }
        await sleep(this.skip ? 0 : 1150);

        // ③ 六次落钱（壳落定：一下弹跳，见 .dz-shell.settle）
        this.phase = 'throw';
        this.settling = true;
        setTimeout(() => { this.settling = false; }, 640);
        const res = await p;
        if (!res || !res.ok) { this.err = (res && res.error) || W.I18N.t('占卜服务未就绪'); }
        const rolls = (res && res.ok && res.rolls) ? res.rolls : this.fakeRolls();
        for (let k = 0; k < 6; k++) {
          const r = rolls[k];
          this.tip = `第 ${k + 1} 次 · ${['初', '二', '三', '四', '五', '上'][k]}爻`;
          // 三枚钱分别落定：背(阳) 朝上 → rotateY 落在 180 的奇数倍
          for (let i = 0; i < 3; i++) {
            const isBack = (r.coins && r.coins[i]) === '背';
            // 第 2~6 次先把桌上的钱收回壳里（快一点、别瞬移，否则看着像跳帧）
            if (this.done.length) {
              this.place(i, SHELL.x, SHELL.y, 0, 0, 1, 'back');
              await sleep(this.skip ? 0 : 190);
            } else {
              this.place(i, SHELL.x, SHELL.y, 0, 0, 0, 'jump');
            }
            await nextFrame();
            this.place(i, SLOTS[i].x, SLOTS[i].y, 1080 + (isBack ? 180 : 0), (i * 27 + k * 11) % 360, 1, 'drop');
          }
          await sleep(this.skip ? 0 : 430);
          // 直接沿用引擎返回的爻视图（含 benCi/bianCi），不在这里重算 —— 页面与引擎必须一致
          this.done = this.done.concat([{
            i: k, yaoName: r.yaoName, value: r.value, name: r.name, yang: r.yang, moving: r.moving,
            // ⚠️ coins 用 null 而不是 [] —— 大衍法没有铜钱，[] 是 truthy 会让模板走错分支
            coins: r.coins || null, benCi: r.benCi || '', bianCi: r.bianCi || '',
            gone: r.gone || null, remain: r.remain || null,
            // 解释层（小象传 / 吉凶标签 / 白话）**直接沿用引擎给的**，页面不自己查表 ——
            // 否则「页面显示的解释」与「引擎算的解释」迟早分成两套口径
            benXiang: r.benXiang || null, benLuck: r.benLuck || null,
            benSay: r.benSay || null, bianXiang: r.bianXiang || null, bianSay: r.bianSay || null,
          }]);
          await sleep(this.skip ? 0 : 150);
        }

        // ④ 收势
        this.phase = 'done';
        this.tip = '卦已成';
        if (res && res.ok) this.result = res;
        else if (!this.err) this.err = W.I18N.t('占卜服务未就绪');
      },

      // 后端拿不到时，至少让动画与六爻能跑完（不假装有解读）
      fakeRolls() {
        const out = [];
        for (let i = 0; i < 6; i++) {
          const coins = [0, 0, 0].map(() => (Math.random() < 0.5 ? '背' : '字'));
          const back = coins.filter(c => c === '背').length;
          const value = { 3: 9, 2: 8, 1: 7, 0: 6 }[back];
          const yang = value === 7 || value === 9;
          out.push({
            i, coins, value, yang, moving: value === 6 || value === 9,
            name: { 9: '老阳·重', 8: '少阴·拆', 7: '少阳·单', 6: '老阴·交' }[value],
            yaoName: (i === 0 || i === 5 ? ['初', '上'][i / 5 | 0] + (yang ? '九' : '六') : (yang ? '九' : '六') + ['', '二', '三', '四', '五'][i]),
            yong: null,
          });
        }
        return out;
      },

      reset() {
        this.phase = 'idle'; this.done = []; this.result = null; this.err = ''; this.skip = false;
        this.settling = false;
        this.tip = '静心默念所求，再点「开始摇卦」';
        for (let i = 0; i < 3; i++) this.place(i, SHELL.x, SHELL.y, 0, 0, 0, 'jump');
      },
      fastForward() { this.skip = true; },
      pct(v) { return (v * 100).toFixed(1) + '%'; },
      yaoGlyph(name) { return name; },
    },
    template: `
    <div class="wrap">
      <div class="pagehead">
        <div>
          <h1>{{ t('八卦占卜') }}</h1>
          <div class="sub" v-html="t('当期卡池日期自动获取 · 两套正统起卦法（三枚铜钱 / 大衍揲蓍）· 按朱熹《易学启蒙》变占取用 · 卦辞爻辞带注疏与白话 · 剩余期内逐日择吉 · <b>卦只定「要几成把握」，抽数由官方概率模型解出单点</b> —— 不给「1~79」这种用不上的范围')"></div>
        </div>
        <div class="pg-actions">
          <select class="dz-sel dz-sel-s" v-model="method" :disabled="busy" :title="t('起卦法：两种都是正统源流，动爻数分布完全相同')">
            <option value="coin">{{ t('三枚铜钱法') }}</option>
            <option value="yarrow">{{ t('大衍揲蓍法') }}</option>
          </select>
          <select class="dz-sel dz-sel-pool" v-model="gt" :disabled="busy">
            <option v-for="p in pools" :key="p.gt" :value="p.gt">{{ p.label }}{{ t('（已垫 {n}）', { n: p.cur }) }}</option>
          </select>
          <select class="dz-sel dz-sel-s" v-if="curPool && curPool.unique" v-model="upMode" :disabled="busy"
                  :title="t('当前保底状态：决定「出金时是当期」的概率')">
            <option value="small">{{ t('小保底') }}</option>
            <option value="big">{{ t('大保底') }}</option>
          </select>
          <button class="btn" v-if="busy" @click="fastForward">{{ t('跳过动画') }}</button>
          <button class="btn" v-if="phase==='done'" @click="reset">{{ t('重新起卦') }}</button>
          <button class="btn pri" v-else-if="!busy" @click="start">{{ t('开始摇卦') }}</button>
        </div>
      </div>

      <!-- ── 当期卡池（自动获取；这也是全平台唯一的联网点）────────────── -->
      <div class="dz-bn" v-if="bnTerm">
        <div class="dz-bn-main">
          <span class="dz-bn-tag">{{ t('当期卡池') }}</span>
          <b class="dz-bn-ver">v{{ bnTerm.version }}{{ bnTerm.half ? ' · ' + t(bnTerm.half) : '' }}</b>
          <span class="dz-bn-date">{{ bnTerm.start }} ~ {{ bnTerm.end }}</span>
          <span class="dz-bn-rm" :class="{ hot: banner.remain.days <= 2 }">{{ t('剩余 {n} 天', { n: banner.remain.days }) }}</span>
          <span class="dz-bn-cal" v-if="bnCalibrated" :title="t('开池时刻与本地抽卡记录的首抽时间对得上')">{{ t('已校准') }}</span>
        </div>
        <div class="dz-bn-ups">
          <span v-if="bnTerm.upChars.length"><i>{{ t('UP 角色') }}</i>{{ bnTerm.upChars.map(x => n(x)).join(' / ') }}</span>
          <span v-if="bnTerm.upCones.length"><i>{{ t('UP 光锥') }}</i>{{ bnTerm.upCones.map(x => n(x)).join(' / ') }}</span>
        </div>
        <div class="dz-bn-note">
          {{ L(banner.note, banner.noteEn) }}<template v-if="bnCalibrated"> {{ t('· 开池时刻已用本地抽卡记录校准') }}</template>
          <template v-if="banner.source === 'builtin'"> {{ t('· 当前用的是内置表（联网取不到）') }}</template>
          <template v-if="banner.stale"> {{ t('· 缓存已过期，显示的是上次结果') }}</template>
        </div>
      </div>
      <div class="note dz-err" v-if="bannerErr">{{ t('卡池日历取不到：') }}{{ bannerErr }}　{{ t('（其余功能不受影响）') }}</div>

      <div class="dz-top">
        <!-- ── 桌面 ────────────────────────────────────────────────────── -->
        <div class="dz-stage" ref="stage">
          <svg class="dz-plate" viewBox="0 0 400 400" aria-hidden="true">
            <defs>
              <radialGradient id="dzWood" cx="42%" cy="34%" r="78%">
                <stop offset="0%" stop-color="var(--dz-plate-1)"/><stop offset="62%" stop-color="var(--dz-plate-2)"/><stop offset="100%" stop-color="var(--dz-plate-l1)"/>
              </radialGradient>
            </defs>
            <!-- 罗盘：八个卦名画在半径 165（41%）的外圈，给中间的龟壳与铜钱留出净空 -->
            <circle cx="200" cy="200" r="192" fill="url(#dzWood)" stroke="var(--dz-plate-l1)" stroke-width="1.5"/>
            <circle cx="200" cy="200" r="188" fill="none" stroke="var(--dz-plate-l2)" stroke-width="1"/>
            <circle cx="200" cy="200" r="142" fill="none" stroke="var(--dz-plate-l3)" stroke-width="1"/>
            <g v-for="b in bagua" :key="b.n">
              <line :x1="(200 + 142 * Math.sin((b.deg + 22.5) * Math.PI / 180)).toFixed(1)"
                    :y1="(200 - 142 * Math.cos((b.deg + 22.5) * Math.PI / 180)).toFixed(1)"
                    :x2="(200 + 188 * Math.sin((b.deg + 22.5) * Math.PI / 180)).toFixed(1)"
                    :y2="(200 - 188 * Math.cos((b.deg + 22.5) * Math.PI / 180)).toFixed(1)"
                    stroke="var(--dz-plate-div)" stroke-width="1"/>
              <text :x="(200 + 156 * Math.sin(b.deg * Math.PI / 180)).toFixed(1)"
                    :y="(200 - 156 * Math.cos(b.deg * Math.PI / 180)).toFixed(1)"
                    text-anchor="middle" dominant-baseline="central"
                    font-size="19" fill="var(--dz-gua-tx)">{{ b.g }}</text>
              <text :x="(200 + 174 * Math.sin(b.deg * Math.PI / 180)).toFixed(1)"
                    :y="(200 - 174 * Math.cos(b.deg * Math.PI / 180)).toFixed(1)"
                    text-anchor="middle" dominant-baseline="central"
                    font-size="10" fill="var(--dz-gua-idx)">{{ b.n }}</text>
            </g>
            <g transform="translate(200,200)">
              <circle r="32" fill="var(--dz-tai-1)" stroke="var(--dz-tai-ring)" stroke-width="1.5"/>
              <path d="M0,-32 A32,32 0 0,1 0,32 A16,16 0 0,1 0,0 A16,16 0 0,0 0,-32 Z" fill="var(--dz-tai-2)"/>
              <circle cx="0" cy="-16" r="5.2" fill="var(--dz-tai-1)"/>
              <circle cx="0" cy="16" r="5.2" fill="var(--dz-tai-2)"/>
            </g>
          </svg>

          <div class="dz-shellwrap" :style="{ left: shell.x + '%', top: shell.y + '%' }">
            <div class="dz-shell" :class="{ shake: phase==='shake', settle: settling, shine: phase==='done' }">
              <svg :viewBox="'0 0 ' + shellGeo.w + ' ' + shellGeo.h">
                <defs>
                  <radialGradient id="dzPlG" cx="36%" cy="22%" r="84%">
                    <stop offset="0%" stop-color="var(--dz-shell-1)"/><stop offset="46%" stop-color="var(--dz-shell-2)"/>
                    <stop offset="82%" stop-color="var(--dz-shell-3)"/><stop offset="100%" stop-color="var(--dz-shell-4)"/>
                  </radialGradient>
                  <!-- 壳缘的厚度光：上缘highlight、下缘压暗 -->
                  <linearGradient id="dzPlEdge" x1="0" y1="0" x2="0.2" y2="1">
                    <stop offset="0%" stop-color="var(--dz-shell-hi)" stop-opacity=".8"/>
                    <stop offset="55%" stop-color="var(--dz-shell-seam)" stop-opacity=".12"/>
                    <stop offset="100%" stop-color="var(--dz-shell-4)" stop-opacity=".42"/>
                  </linearGradient>
                  <radialGradient id="dzPlDome" cx="34%" cy="18%" r="88%">
                    <stop offset="0%" stop-color="var(--dz-shell-hi)" stop-opacity=".42"/>
                    <stop offset="38%" stop-color="var(--dz-shell-hi)" stop-opacity="0"/>
                    <stop offset="100%" stop-color="var(--dz-shell-4)" stop-opacity=".38"/>
                  </radialGradient>
                  <radialGradient id="dzPlHot" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="var(--dz-zhao)" stop-opacity=".3"/>
                    <stop offset="55%" stop-color="var(--dz-zhao)" stop-opacity=".1"/>
                    <stop offset="100%" stop-color="var(--dz-zhao)" stop-opacity="0"/>
                  </radialGradient>
                  <!-- 骨缝与钻凿一律裁进轮廓内 —— 否则骨缝端点会顶出壳缘，看着像长了倒刺 -->
                  <clipPath id="dzPlClip"><path :d="shellGeo.outline"/></clipPath>
                </defs>
                <ellipse cx="66" cy="82" rx="53" ry="17" fill="var(--dz-shell-4)" opacity=".15"/>
                <path :d="shellGeo.outline" fill="url(#dzPlG)" stroke="var(--dz-shell-ring)" stroke-width="1.7"/>
                <g clip-path="url(#dzPlClip)">
                  <line v-for="(t,i) in shellGeo.rim" :key="'r'+i" :x1="t[0]" :y1="t[1]" :x2="t[2]" :y2="t[3]"
                        stroke="var(--dz-shell-seam)" stroke-width=".7" opacity=".3"/>
                  <path v-for="(d,i) in shellGeo.seams" :key="'s'+i" :d="d"
                        fill="none" stroke="var(--dz-shell-seam)" stroke-width="1.05" opacity=".6"/>
                  <path :d="shellGeo.qianliTop" fill="none" stroke="var(--dz-shell-ring)" stroke-width="1.35" opacity=".7"/>
                  <path :d="shellGeo.qianliBot" fill="none" stroke="var(--dz-shell-ring)" stroke-width="1.45" opacity=".72"/>
                  <path :d="shellGeo.ento" fill="var(--dz-shell-ento)" opacity=".5"/>
                  <path :d="shellGeo.ento" fill="none" stroke="var(--dz-shell-seam)" stroke-width=".95" opacity=".55"/>
                  <g v-for="(z,i) in shellGeo.zuo" :key="'z'+i">
                    <circle :cx="z[0]" :cy="z[1]" r="2.4" fill="var(--dz-shell-4)" opacity=".13"/>
                    <circle :cx="z[0]" :cy="z[1]" r="1" fill="var(--dz-zuo)" opacity=".15"/>
                    <ellipse :cx="z[0]" :cy="z[1]+4.4" rx="1.5" ry="3.2" fill="var(--dz-shell-4)" opacity=".12"/>
                  </g>
                  <!-- 灼兆：卦成之后才「透出来」（.dz-shell.shine 控制透明度） -->
                  <g class="dz-zhao">
                    <circle v-for="(h,i) in shellGeo.zhaoHot" :key="'g'+i" class="dz-zhao-glow"
                            :cx="h[0]" :cy="h[1]" r="7.5" fill="url(#dzPlHot)"/>
                    <path v-for="(d,i) in shellGeo.zhaoGan" :key="'k'+i" :d="d"
                          fill="none" stroke="var(--dz-zhao)" stroke-width="1.45" stroke-linecap="round" opacity=".82"/>
                    <path v-for="(d,i) in shellGeo.zhaoZhi" :key="'b'+i" :d="d"
                          fill="none" stroke="var(--dz-zhao)" stroke-width="1.25" stroke-linecap="round" opacity=".74"/>
                  </g>
                  <path :d="shellGeo.outline" fill="none" stroke="url(#dzPlEdge)" stroke-width="3.4" opacity=".55"/>
                </g>
                <path :d="shellGeo.outline" fill="url(#dzPlDome)"/>
                <ellipse cx="42" cy="23" rx="13" ry="7" fill="var(--dz-shell-hi)" opacity=".13" transform="rotate(-16 42 23)"/>
                <path :d="shellGeo.outline" fill="none" stroke="var(--dz-shell-edge)" stroke-width="1" opacity=".55"/>
              </svg>
            </div>
          </div>

          <div class="dz-coins">
            <div v-for="(c,i) in coins" :key="i" class="dz-coin"
                 :style="{ transform: c.tf, transition: c.tr, opacity: c.op }">
              <!-- ⚠️ 抖动必须套一层内元素：外层的 transform 是 JS 下发的「落点」（要吃 transition），
                   内层才能挂 keyframes —— 直接给 .dz-coin 加动画会盖掉落点位移 -->
              <div class="dz-coin-in" :class="{ rattle: phase==='shake' }">
                <div class="dz-face dz-zi">
                  <span class="c t">星</span><span class="c r">穹</span>
                  <span class="c b">通</span><span class="c l">宝</span>
                  <i class="hole"></i>
                </div>
                <div class="dz-face dz-bei"><i class="hole"></i><span class="mk">背</span></div>
              </div>
            </div>
          </div>

          <div class="dz-tip">{{ t(tip) }}</div>
        </div>

        <!-- ── 六爻 ────────────────────────────────────────────────────── -->
        <div class="dz-side">
          <div class="dz-card">
            <div class="dz-card-h">
              <b>{{ t('六爻') }}</b><span class="dz-mini">{{ t('自下而上：第一次 = 初爻') }}</span>
            </div>
            <div class="dz-hex">
              <div v-for="row in hexRows" :key="row.i" class="dz-hrow" :class="{ empty: row.empty, moving: row.moving }">
                <span class="dz-hname">{{ row.empty ? '—' : row.yaoName }}</span>
                <span class="dz-yao" v-if="!row.empty">
                  <i class="bar" v-for="n in (row.yang ? 1 : 2)" :key="n"></i>
                </span>
                <span class="dz-yao ph" v-else><i class="bar"></i></span>
                <span class="dz-hmov">{{ row.empty ? '' : (row.moving ? (row.value === 9 ? t('○ 老阳') : t('✕ 老阴')) : t('静')) }}</span>
              </div>
            </div>
            <div class="dz-legend">
              <template v-if="method === 'yarrow'">
                <span>{{ t('四十九策 · 三变一爻') }}</span>
                <span>{{ t('老阳 3/16 · 少阴 7/16 · 少阳 5/16 · 老阴 1/16') }}</span>
              </template>
              <template v-else>
                <span><i class="dot gold"></i>{{ t('背 = 阳') }}</span>
                <span><i class="dot dim"></i>{{ t('字 = 阴') }}</span>
              </template>
              <span>{{ t('○ 老阳 · ✕ 老阴 = 动爻') }}</span>
            </div>
          </div>

          <div class="dz-card" v-if="done.length">
            <div class="dz-card-h"><b>{{ method === 'yarrow' ? t('三变一爻 · 明细') : t('三次一爻 · 明细') }}</b></div>
            <table class="dz-tbl">
              <tbody>
                <!-- ⚠️ v-for 与 v-if 不能同挂一个元素（Vue3 里 v-if 先求值，row 尚未定义）→ 用 template 包一层 -->
                <template v-for="row in hexRows" :key="row.i">
                  <tr v-if="!row.empty">
                    <td class="k">{{ row.yaoName }}</td>
                    <td class="v">
                      <template v-if="row.coins">
                        <span v-for="(c,j) in row.coins" :key="j" class="dz-coinmini" :class="{ back: c==='背' }">{{ c }}</span>
                      </template>
                      <span v-else class="dz-coinmini">{{ row.gone ? t('{g} → 余 {r}', { g: row.gone.join('+'), r: row.remain }) : '—' }}</span>
                    </td>
                    <td class="r">{{ row.name }}</td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ── 今日吉时（常驻：进页就能看，不必先摇卦） ──────────────────── -->
      <h2>{{ t('今日吉时') }} <small>{{ t('时家择吉 · 十二时辰排序 · 万年历') }}</small></h2>
      <div class="dz-card dz-zt">
        <div class="dz-err" v-if="zeriErr">{{ t('择时数据取不到：') }}{{ zeriErr }}</div>
        <template v-else-if="zeri">
          <div class="dz-zt-top">
            <div class="dz-zt-day">
              <b>{{ zeri.date }} · {{ zeri.day.gz }}日</b>
              <span class="dz-mini">
                农历{{ zeri.day.lunar }} · {{ zeri.day.type }}日（{{ zeri.day.tianShen }}）· 建除「{{ zeri.day.zhiXing }}」 ·
                星宿「{{ zeri.day.xiu }}」· 旬空 {{ zeri.day.xunKong || '无' }}
              </span>
              <span class="dz-mini" v-if="zeri.day.cai">财神 {{ zeri.day.cai }} · 喜神 {{ zeri.day.xi }} · 福神 {{ zeri.day.fu }}</span>
            </div>
            <div class="dz-zt-now" v-if="nowHour">
              {{ t('此刻') }} <b>{{ nowHour.zhi }}时</b> · {{ t(nowHour.label) }}
            </div>
          </div>

          <div class="dz-zt-best" :class="'lv-' + bestHour.level">
            <span class="k">{{ bestHour.level === 's1' ? t('今日最宜') : t('今日无吉时 · 退求其次') }}</span>
            <span class="v">{{ bestHour.zhi }}时 {{ bestHour.range }}</span>
            <span class="s">{{ bestHour.tianShen }}·{{ bestHour.type }}{{ bestWhy ? ' · ' + bestWhy : '' }}　{{ t('得分') }} {{ bestHour.score > 0 ? '+' : '' }}{{ bestHour.score }}</span>
          </div>

          <!-- 十二时辰吉凶时序条（自然序，不是排名序） -->
          <div class="dz-zt-bar">
            <div v-for="h in ztOrder" :key="h.zhi" class="dz-zt-seg" :class="['lv-' + h.level, { now: nowHour && nowHour.zhi === h.zhi }]"
                 :title="h.zhi + '时 ' + h.range + '　' + h.label + '　' + (h.marks.map(m => m.tag).join(' '))">
              <span class="z">{{ h.zhi }}</span>
              <span class="r">{{ h.range }}</span>
            </div>
          </div>
          <div class="dz-zt-legend">
            <span><i class="sw lv-s1"></i>{{ t('吉时') }}</span>
            <span><i class="sw lv-s2"></i>{{ t('次吉') }}</span>
            <span><i class="sw lv-s0"></i>{{ t('平常') }}</span>
            <span><i class="sw lv-sx"></i>{{ t('凶时') }}</span>
            <span class="sp">{{ t('按十二时辰自然序排列 · 描边为此刻所在时辰') }}</span>
          </div>

          <table class="dz-tbl dz-zt-tbl">
            <thead>
              <tr><th>#</th><th>{{ t('时辰') }}</th><th>{{ t('时段') }}</th><th>{{ t('吉凶依据') }}</th><th>{{ t('分') }}</th><th>{{ t('判定') }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="h in zeri.hours" :key="h.zhi">
                <td class="k">{{ h.rank }}</td>
                <td class="k">{{ h.zhi }}时<small>{{ h.gz }}</small></td>
                <td class="t">{{ h.range }}</td>
                <td class="marks">
                  <span v-for="(m,k) in h.marks" :key="k" class="dz-mk" :class="{ neg: m.d < 0 }">{{ m.tag }}</span>
                </td>
                <td class="sc">{{ h.score > 0 ? '+' : '' }}{{ h.score }}</td>
                <td class="lb"><span class="dz-lg" :class="'lv-' + h.level">{{ t(h.label) }}</span></td>
              </tr>
            </tbody>
          </table>

          <div class="dz-zt-yiji" v-if="(zeri.day.yi && zeri.day.yi.length) || (zeri.day.ji && zeri.day.ji.length)">
            <div><span class="k">{{ t('宜') }}</span><span class="v yi">{{ (zeri.day.yi || []).slice(0, 9).join('、') || '无' }}</span></div>
            <div><span class="k">{{ t('忌') }}</span><span class="v ji">{{ (zeri.day.ji || []).slice(0, 9).join('、') || '无' }}</span></div>
            <div><span class="k">{{ t('日吉神') }}</span><span class="v">{{ (zeri.day.jiShen || []).join('、') || '无' }}</span></div>
            <div><span class="k">{{ t('日凶煞') }}</span><span class="v bad">{{ (zeri.day.xiongSha || []).join('、') || '无' }}</span></div>
          </div>

          <details class="dz-more">
            <summary>{{ t('择时口径（4 个维度 + 档位阈值）—— 点开可逐条复核') }}</summary>
            <ul class="dz-ul">
              <li v-for="d in zeri.doc.dims" :key="d.k"><b>{{ d.k }}</b> — {{ d.v }}</li>
              <li><b>{{ t('档位阈值') }}</b> — {{ zeri.doc.levels }}</li>
              <li><b>{{ t('升档与降档') }}</b> — {{ zeri.doc.upgrade }}</li>
              <li><b>{{ t('子时口径') }}</b> — {{ zeri.doc.note }}</li>
              <li><b>{{ t('免责') }}</b> — {{ zeri.doc.duty }}</li>
            </ul>
          </details>
        </template>
      </div>

      <!-- ── 剩余期内择日（常驻；要卡池日期回来才有意义）────────────────── -->
      <template v-if="range">
        <h2>{{ t('剩余期内择日') }} <small v-html="t('日家择吉 · 只在当期卡池剩下的 {n} 天里排', { n: range.n })"></small></h2>
        <div class="dz-card dz-rg">
          <div class="dz-rg-top">
            <span class="dz-mini">{{ t('扫描区间 {a} ~ {b}（{n} 天）', { a: range.start, b: range.end, n: range.n }) }}</span>
            <span class="dz-mini" v-html="bold(range.doc.combine)"></span>
          </div>
          <div class="dz-rg-cut" v-if="rangeCut">
            <span v-html="t('卡池于 <b>{end}</b> 关闭', { end: rangeCut.end })"></span><template v-if="rangeCut.partial"><span v-html="t(' —— 到期当天只开到凌晨，之后的时辰没有池子，<b>因此不作推荐</b>（只排到 {to}）', { to: rangeCut.to })"></span></template>。
          </div>
          <table class="dz-tbl dz-rgt">
            <thead>
              <tr><th>{{ t('名次') }}</th><th>{{ t('日期') }}</th><th>{{ t('日辰') }}</th><th>{{ t('日家') }}</th><th>{{ t('最佳时辰') }}</th><th>{{ t('吉时') }}</th><th>{{ t('综合') }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="d in range.ranked.slice(0, 6)" :key="d.date" :class="{ best: d.rank === 1 }">
                <td class="k"><b>{{ d.rank }}</b></td>
                <td class="k">{{ d.date.slice(5) }}<small>{{ d.weekday }}</small></td>
                <td class="k">{{ d.day.gz }}<small>农历{{ d.day.lunar }}</small></td>
                <td class="lb">
                  <span class="dz-lg" :class="dgCls(d)">{{ t(d.label) }}</span>
                  <span v-for="(m,k) in d.marks" :key="k" class="dz-mk" :class="{ neg: m.d < 0 }">{{ m.tag }}</span>
                </td>
                <td class="k">{{ d.bestHour.zhi }}时<small>{{ d.bestHour.range }} · {{ t(d.bestHour.label) }}</small></td>
                <td class="r">{{ t('{n} 个', { n: d.hoursGood }) }}</td>
                <td class="sc">{{ d.total > 0 ? '+' : '' }}{{ d.total }}</td>
              </tr>
            </tbody>
          </table>
          <details class="dz-more" v-if="range.ranked.length > 6">
            <summary>{{ t('其余 {n} 天的完整排序 —— 点开', { n: range.ranked.length - 6 }) }}</summary>
            <table class="dz-tbl dz-rgt">
              <tbody>
                <tr v-for="d in range.ranked.slice(6)" :key="d.date">
                  <td class="k">{{ d.rank }}</td>
                  <td class="k">{{ d.date.slice(5) }}<small>{{ d.weekday }}</small></td>
                  <td class="k">{{ d.day.gz }}</td>
                  <td class="lb"><span class="dz-lg" :class="dgCls(d)">{{ t(d.label) }}</span>
                    <span v-for="(m,k) in d.marks" :key="k" class="dz-mk" :class="{ neg: m.d < 0 }">{{ m.tag }}</span></td>
                  <td class="k">{{ d.bestHour.zhi }}时<small>{{ d.bestHour.range }}</small></td>
                  <td class="r">{{ d.hoursGood }}</td>
                  <td class="sc">{{ d.total > 0 ? '+' : '' }}{{ d.total }}</td>
                </tr>
              </tbody>
            </table>
          </details>
          <div class="dz-slim" v-html="bold(range.doc.map)"></div>
          <div class="dz-slim" v-html="bold(range.doc.caveat)"></div>
          <details class="dz-more">
            <summary>{{ t('日家打分口径（{n} 个维度 + 档位）—— 点开可逐条复核', { n: range.doc.dims.length }) }}</summary>
            <ul class="dz-ul">
              <li v-for="dd in range.doc.dims" :key="dd.k"><b>{{ dd.k }}</b> — <span v-html="bold(dd.v)"></span></li>
            </ul>
          </details>
        </div>
      </template>
      <div class="note dz-err" v-if="rangeErr">{{ t('剩余期内择日取不到：') }}{{ rangeErr }}</div>

      <div class="note dz-err" v-if="err">{{ err }}　{{ t('（动画里的卦象仅作演示，解读需要服务启动）') }}</div>

      <!-- ── 结果 ──────────────────────────────────────────────────────── -->
      <template v-if="result">
        <h2>{{ t('卦象') }} <small>{{ t('本卦定当下 · 动爻是破局点 · 变卦看趋势') }}</small></h2>
        <div class="dz-gua">
          <div class="dz-gcard">
            <div class="dz-gtag">{{ t('本卦') }}</div>
            <div class="dz-gname">{{ result.ben.full }}</div>
            <div class="dz-gname-en" v-if="guaEn(result.ben.name)">{{ guaEn(result.ben.name) }}</div>
            <div class="dz-gsym">
              <span>{{ trigram[result.ben.shang] }}</span><span>{{ trigram[result.ben.xia] }}</span>
            </div>
            <div class="dz-gsub">{{ t('第 {no} 卦 · 上{shang} 下{xia}', { no: result.ben.no, shang: t(result.ben.shang), xia: t(result.ben.xia) }) }}</div>
            <div class="dz-gci">{{ result.ben.ci }}</div>
            <div class="dz-gxiang" v-if="result.ben.xiang">{{ t('象曰：') }}<span v-html="bold(result.ben.xiang)"></span></div>
            <div class="dz-gsay" v-if="result.ben.say"><i>{{ t('白话') }}</i><span v-html="bold(result.ben.say)"></span></div>
            <details class="dz-more dz-gdet" v-if="result.ben.tuan || result.ben.za || result.ben.yong">
              <summary>{{ t('更多注疏') }}</summary>
              <ul class="dz-ul">
                <li v-if="result.ben.tuan"><b>{{ t('彖传') }}</b> — <span v-html="bold(result.ben.tuan)"></span></li>
                <li v-if="result.ben.za"><b>{{ t('杂卦传') }}</b> — <span v-html="bold(result.ben.za)"></span></li>
                <li v-if="result.ben.yong"><b>{{ result.ben.yong.name }}</b> — <span v-html="bold(result.ben.yong.ci)"></span></li>
              </ul>
            </details>
          </div>
          <div class="dz-garrow">→</div>
          <div class="dz-gcard" :class="{ alt: result.moving.length }">
            <div class="dz-gtag">{{ t('变卦') }}</div>
            <div class="dz-gname">{{ result.bian.full }}</div>
            <div class="dz-gname-en" v-if="guaEn(result.bian.name)">{{ guaEn(result.bian.name) }}</div>
            <div class="dz-gsym">
              <span>{{ trigram[result.bian.shang] }}</span><span>{{ trigram[result.bian.xia] }}</span>
            </div>
            <div class="dz-gsub">{{ t('第 {no} 卦 · {how}', { no: result.bian.no, how: result.moving.length ? t('动爻 {m} 反转而得', { m: result.movingNames.join('、') }) : t('六爻皆不动，与本卦相同') }) }}</div>
            <div class="dz-gci">{{ result.bian.ci }}</div>
            <div class="dz-gxiang" v-if="result.bian.xiang">{{ t('象曰：') }}<span v-html="bold(result.bian.xiang)"></span></div>
            <div class="dz-gsay" v-if="result.bian.say"><i>{{ t('白话') }}</i><span v-html="bold(result.bian.say)"></span></div>
            <details class="dz-more dz-gdet" v-if="result.bian.tuan || result.bian.za">
              <summary>{{ t('更多注疏') }}</summary>
              <ul class="dz-ul">
                <li v-if="result.bian.tuan"><b>{{ t('彖传') }}</b> — <span v-html="bold(result.bian.tuan)"></span></li>
                <li v-if="result.bian.za"><b>{{ t('杂卦传') }}</b> — <span v-html="bold(result.bian.za)"></span></li>
              </ul>
            </details>
          </div>
        </div>

        <h2>{{ t('断卦') }} <small>{{ result.rule.text }}</small></h2>
        <div class="dz-card">
          <div class="dz-cite" v-for="(c,k) in result.cited" :key="k" :class="{ main: c.primary }">
            <div class="dz-cite-h">
              <span class="dz-badge">{{ c.primary ? t('主判据') : t('参考') }}</span>
              <b>{{ c.kind }}</b><span class="dz-lbl">{{ c.label }}</span>
            </div>
            <div class="dz-cite-t">{{ c.text }}</div>
            <div class="dz-var" v-if="c.variants"><b>{{ t('异文') }}</b><span v-for="(v,j) in c.variants" :key="j">{{ v }}</span></div>
          </div>
          <div class="dz-slim" v-html="t('动爻共 <b>{n}</b> 个{list}；取用规则出自朱熹《易学启蒙 · 考变占》，0~6 个动爻各有定法，不由本平台自创。', { n: result.moving.length, list: result.moving.length ? '（' + result.movingNames.join('、') + '）' : '' })"></div>
        </div>

        <h2>{{ t('今日运势') }} <small>{{ t('卦象字面吉凶 · 时辰倾向') }}</small></h2>
        <div class="dz-2col">
          <div class="dz-card">
            <div class="dz-luck">
              <div class="dz-lv" :class="'lv-' + result.luck.level">{{ t(result.luck.label) }}</div>
              <div class="dz-lvtx">
                <b>{{ t(result.luck.action) }}</b>
                <span>{{ t('得分 {tt} = 主判据 {m} + 本卦卦辞 {b} + 变卦卦辞 {bi}', { tt: result.luck.total, m: result.luck.main, b: result.luck.ben, bi: result.luck.bian }) }}</span>
              </div>
            </div>
            <div class="dz-words" v-if="result.luck.mainWords.length">
              {{ t('主判据命中：') }}<b v-for="(w,k) in result.luck.mainWords" :key="k">{{ w }}</b>
            </div>
            <div class="dz-slim" v-html="t('判定方式是把引文里的吉凶字眼按一张固定的词表打分管，<b>命中的字词全部列在上方</b>，可逐条复核。档位阈值按 12000 次抽样的分数分布分位数定，所以「大吉」约占一成、不是随手给的好话。')"></div>
          </div>
          <!-- 万年历（日家/时家/宜忌）已移到上方常驻的「今日吉时」卡里，
               这里只留「卦与时的关系」——两张卡不重复同一份信息 -->
          <div class="dz-card">
            <div class="dz-card-h"><b>{{ t('择时') }}</b><span class="dz-mini">{{ t('卦定宜进宜守 · 时辰另算') }}</span></div>
            <div class="dz-alm" v-if="bestHour">
              <div><span class="k">{{ t('今日最宜') }}</span><span class="v">{{ bestHour.zhi }}时 {{ bestHour.range }}（{{ t(bestHour.label) }}{{ bestWhy ? ' · ' + bestWhy : '' }}）</span></div>
              <div v-if="nowHour"><span class="k">{{ t('此刻') }}</span><span class="v">{{ nowHour.zhi }}时 — {{ t(nowHour.label) }}{{ nowHour.level === 's1' ? t('，正当吉时') : '' }}</span></div>
              <div v-if="result.almanac.hour"><span class="k">{{ t('摇卦时') }}</span><span class="v">{{ result.almanac.hour.zhi }}时 {{ result.almanac.hour.gz }}（{{ result.almanac.hour.type }} · {{ result.almanac.hour.tianShen }}）</span></div>
            </div>
            <div class="dz-slim" v-html="t('十二时辰的完整吉凶榜与打分依据见上方「今日吉时」。<b>卦与时辰互不改数</b>：时辰只回答「什么时候出手」，出手抽多少仍由保底模型给出。')"></div>
            <div class="dz-slim" v-if="!bestHour && zeriErr">{{ t('择时数据取不到：') }}{{ zeriErr }}</div>
          </div>
        </div>

        <h2>{{ t('时机推演') }} <small>{{ t('卦定把握度 · 数学定抽数 · 给单点不给范围') }}</small></h2>
        <div class="dz-card">
          <div class="dz-tmg">
            <div class="dz-tmg-l">
              <div class="dz-tmg-k">
                {{ headline.kind === 'up' ? t('拿当期限定 · 把握线') : t('出金线 · 建议出手点') }}
              </div>
              <div class="dz-tmg-v">{{ headline.at }} <small>{{ t('本池第几抽') }}</small></div>
              <div class="dz-tmg-s">
                {{ t('还需 <b>{d}</b> 抽 · 实际把握 <b>{c}</b>', { d: headline.draws, c: pct(headline.chance) }) }}
              </div>
              <div class="dz-tmg-s">{{ headline.note }}</div>
              <div class="dz-tmg-s">
                {{ t('卦象档位 <b>{g}</b>（目标 {p}）。实际落点会略高于目标 —— 软保底区一抽能跳好几个百分点，停不到整数上。', { g: result.timing.goalNote, p: pct(result.timing.goal) }) }}
              </div>
            </div>
            <div class="dz-tmg-r">
              <div class="dz-tblrow" v-for="l in lines" :key="l.key">
                <span class="k">{{ t(l.name) }}<small>{{ t(l.tag) }}</small></span>
                <span class="v">
                  <b>{{ l.reached ? t('本池第 {n} 抽', { n: l.at }) : t('需跨期 {n} 抽', { n: l.draws }) }}</b>
                  <span v-if="l.reached">{{ t('（还需 {n}）', { n: l.draws }) }}</span>
                  · {{ t('把握') }} {{ pct(l.chance) }}<em v-if="!l.reached" class="dz-note">{{ t('（跨期累计）') }}</em>
                  <em v-if="!l.reached" class="dz-warn">{{ t('超出本期！本期最多 {p}', { p: pct(l.maxChance) }) }}</em>
                </span>
              </div>
              <div class="dz-tblrow"><span class="k">{{ t('起卦法') }}</span><span class="v">{{ t(result.method.name) }} · {{ t(result.method.how) }}</span></div>
              <div class="dz-tblrow"><span class="k">{{ t('卡池') }}</span><span class="v">{{ result.timing.pool }}{{ result.timing.approx ? t('（官方未公示软保底，按基础概率 + 硬保底建模）') : '' }}</span></div>
              <div class="dz-tblrow"><span class="k">{{ t('已垫 / 硬保底') }}</span><span class="v">{{ result.timing.cur }} / {{ result.timing.hard }} · {{ t('还剩 {n} 抽必出', { n: result.timing.remain }) }}</span></div>
              <div class="dz-tblrow" v-if="result.timing.unique">
                <span class="k">{{ t('保底状态') }}</span>
                <span class="v">{{ result.timing.upMode === 'big' ? t('大保底 · 出金必定是当期') : t('小保底 · 出金有 {p}% 是当期', { p: (result.timing.pUp * 100).toFixed(0) }) }}<em v-if="result.timing.upEstimated" class="dz-note">{{ t('（本池官方未单独公示 UP 率，按同类池口径估）') }}</em></span>
              </div>
              <div class="dz-tblrow"><span class="k">{{ t('平均还需') }}</span><span class="v">{{ t('{m} 抽出金（数学期望）· 半数人 {p} 抽内出金', { m: result.timing.mean.toFixed(1), p: result.timing.ref.p50 }) }}</span></div>
              <div class="dz-tblrow" v-if="result.timing.unique">
                <span class="k">{{ t('稳拿所需') }}</span><span class="v">{{ t('{n} 抽 —— 小保底最坏要「歪一次 + 再吃满一个保底」，会跨到下一期', { n: result.timing.upSafe }) }}</span>
              </div>
            </div>
          </div>

          <div class="dz-curve" v-if="curve">
            <svg :viewBox="'0 0 ' + curveW + ' ' + curveH" preserveAspectRatio="none">
              <path :d="curve.p" fill="none" stroke="var(--purple)" stroke-width="2"/>
              <path v-if="result.timing.unique" :d="curve.u" fill="none" stroke="var(--gold)" stroke-width="2" stroke-dasharray="5 3"/>
              <line :x1="curveW * (headline.at - result.timing.cur - 1) / Math.max(1, result.timing.remain - 1)" y1="0"
                    :x2="curveW * (headline.at - result.timing.cur - 1) / Math.max(1, result.timing.remain - 1)" :y2="curveH"
                    stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="4 3"/>
            </svg>
            <div class="dz-curve-l">
              {{ t('未来 {n} 抽的累计把握曲线：实线 = 出金', { n: result.timing.remain }) }}<span v-if="result.timing.unique">{{ t('，虚线 = 拿到当期限定') }}</span>{{ t('；竖线 = 主推的第 {at} 抽', { at: headline.at }) }}
            </div>
          </div>

          <table class="dz-tbl dz-anc">
            <thead>
              <tr><th>{{ t('本池第几抽') }}</th><th>{{ t('还需') }}</th><th>{{ t('该抽单抽概率') }}</th><th>{{ t('累计把握') }}</th><th>{{ t('刻度') }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in result.timing.anchors" :key="r.abs" :class="{ hit: r.abs === headline.at }">
                <td class="k">{{ r.abs }}</td>
                <td class="t">{{ r.k }}</td>
                <td class="t">{{ pct(r.p1) }}</td>
                <td class="t">{{ pct(r.pc) }}</td>
                <td class="w">{{ r.tags.join(' · ') }}</td>
              </tr>
            </tbody>
          </table>

          <div class="dz-slim" v-html="t('<b>为什么给单点，不给范围</b>：范围（比如「1~79 抽」）对决策没用 —— 它把「第 1 抽就出」和「第 79 抽才出」并列成同一件事。这里的做法是：卦象先定「几成把握算够」（大吉六成 → 凶等硬保底），再由官方概率模型解出<b>最小的那一抽</b>，并把这一抽的<b>真实把握</b>一起给出。')"></div>
          <div class="dz-slim" v-html="t('<b>概率从哪来</b>：官方只公示「基础概率 + 综合概率 + 硬保底」，没公示软保底曲线。本平台用的曲线（角色 74 抽起每抽 +6%、光锥 66 抽起每抽 +7%）<b>回算综合概率 1.605% / 1.872%</b>，与官方公示的 1.600% / 1.870% 吻合。整条累计曲线已用 <b>20 万次蒙特卡洛</b>对账，解析值与模拟值差在 0.2 个百分点以内。<b>卦不会凭空多给你运气</b>，它只决定你要求几成把握才出手。')"></div>
        </div>

        <h2>{{ t('逐爻明细') }} <small>{{ (method === 'yarrow' ? t('十八变的归奇与余策') : t('三枚铜钱的正反')) + t(' · 与对应爻辞') }}</small></h2>
        <div class="dz-card">
          <table class="dz-tbl wide">
            <thead>
              <tr><th>{{ t('爻位') }}</th><th>{{ method === 'yarrow' ? t('三变归奇') : t('三枚铜钱') }}</th><th>{{ t('爻象') }}</th><th>{{ t('爻辞') }}</th><th>{{ t('吉凶') }}</th><th>{{ t('解释 · 白话') }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in hexRows" :key="row.i" :class="{ moving: row.moving }">
                <td class="k">{{ row.yaoName }}</td>
                <td class="v">
                  <template v-if="row.coins">
                    <span v-for="(c,j) in row.coins" :key="j" class="dz-coinmini" :class="{ back: c==='背' }">{{ c }}</span>
                  </template>
                  <span v-else class="dz-coinmini">{{ row.gone ? t('{g} → 余 {r}', { g: row.gone.join('+'), r: row.remain }) : '—' }}</span>
                </td>
                <td class="r">{{ row.name }}{{ row.moving ? t(' · 动') : '' }}</td>
                <td class="ct">
                  <div class="dz-ciw">{{ row.benCi }}
                    <div class="dz-ylc" v-if="row.bianCi && row.bianCi !== row.benCi">{{ t('变卦：') }}{{ row.bianCi }}</div>
                  </div>
                </td>
                <td class="r"><span class="dz-lg" :class="luckCls(row.benLuck)">{{ luckTx(row.benLuck) }}</span></td>
                <td class="ct">
                  <div class="dz-xs" v-if="row.benXiang"><i>{{ t('小象') }}</i>{{ row.benXiang }}</div>
                  <div class="dz-xs say" v-if="row.benSay"><i>{{ t('白话') }}</i><span v-html="bold(row.benSay)"></span></div>
                  <div class="dz-xs" v-if="row.bianXiang"><i>{{ t('变爻') }}</i>{{ row.bianXiang }}</div>
                  <div class="dz-xs say" v-if="row.bianSay"><i>{{ t('变白话') }}</i><span v-html="bold(row.bianSay)"></span></div>
                  <span v-if="!row.benXiang && !row.benSay" class="dz-muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>{{ t('口径与免责') }}</h2>
        <div class="dz-card">
          <ul class="dz-ul">
            <li v-html="t('<b>起卦法一 · 三枚铜钱</b>：<b>背为阳</b>（一背二字「单·少阳」／二背一字「拆·少阴」／三背「重·老阳」／三字「交·老阴」）。概率由三枚公平硬币决定：少阳 3/8、少阴 3/8、老阳 1/8、老阴 1/8 —— 不是四种各 1/4。')"></li>
            <li v-html="t('<b>起卦法二 · 大衍揲蓍</b>：四十九策，分二·挂一·揲四·归奇，三变一爻、十八变一卦。四象概率 老阳 3/16、少阴 7/16、少阳 5/16、老阴 1/16（归奇只出 13/17/21/25，余策 36/32/28/24 除以 4）。⚠️ 网上不少页面把少阳与少阴写成 7/16 和 5/16，那是错的 —— 本平台这组数用 60 万次抽样钉死，实测 18.71% / 43.79% / 31.24% / 6.26%。')"></li>
            <li v-html="t('<b>两法的关系</b>：两法的 P(该爻为动爻) 都是 1/4，所以 <b>动爻数与变卦的分布完全相同</b>（0~6 个动爻的概率都与 B(6, ¼) 吻合，实测偏差小于 0.5 个百分点）。差别只在「动的那一爻是阳变阴还是阴变阳」—— 大衍法 3:1 偏阳变阴，铜钱法 1:1。<b>换起卦法不会让卦象变多或变少</b>。')"></li>
            <li v-html="t('<b>成卦</b>：六爻<b>自下而上</b>排列，第一次掷的落在初爻。老阳/老阴为动爻，动爻阴阳反转得变卦。')"></li>
            <li v-html="t('<b>取用</b>：朱熹《易学启蒙 · 考变占》按动爻数 0~6 决定读本卦卦辞、动爻爻辞还是变卦卦辞，以上爻/下爻为主也有定法。')"></li>
            <li v-html="t('<b>引文</b>：卦辞与爻辞取自三个互相独立的开源数据集，归一化爻序与繁简后<b>多数票定稿</b>：卦辞 61/64、爻辞 362/384 三源逐字一致；有异文的条目在上方标注了各源原文。')"></li>
            <li v-html="t('<b>吉凶</b>：字面词表打分，不是卦义阐释；命中的词全部列出，可自行复核。档位阈值按 12000 次抽样的分位数标定，不是手拍。')"></li>
            <li v-html="t('<b>抽数为什么是单点</b>：全部来自官方公示概率模型，与卦象无关。卦象只决定<b>「要几成把握才出手」</b>（大吉六成 → 凶等硬保底），抽数是解出的<b>最小达标那一抽</b>。软保底区一抽能跳好几个百分点，所以实际把握会略高于目标值 —— 这是离散分布的性质，不是算宽了。')"></li>
            <li v-html="t('<b>出金线 vs UP 线</b>：出金 = 任何 5★；UP 线 = 当期限定，且把「先歪一次、再吃大保底」整段算进去。小保底时 UP 线可能<b>超出本期</b>（最坏要歪一次再吃满一个保底）；这时页面直接摊开本期天花板，而不是给一个根本做不到的数字。')"></li>
            <li v-html="t('<b>准确性</b>：概率部分（「第 N 抽」、UP 线、稳拿抽数）已用 <b>20 万次蒙特卡洛</b>对账，解析值与模拟值差在 0.2 个百分点以内，「稳拿」抽数经 2 万次模拟无一失手。⚠️ 但这些精确性<b>全部来自游戏的概率系统，不是占卜的预测力</b> —— 卦只提供「几成把握算够」这把尺子。')"></li>
            <li v-html="t('<b>卡池日期</b>：当期卡池的起止与 UP 名单来自第三方日历（api.ennead.cc），<b>不是官方接口</b>。数据源给的开始时刻偏 +7 小时，已用本地抽卡记录的「首抽时间」校准到开池当日中午；如与游戏内公告不符，<b>以游戏内为准</b>。这是本页唯一的联网请求，其余功能全部离线可用。')"></li>
            <li v-html="t('<b>解释的四个层次</b>：彖传（释卦辞）· 大象传（释卦象）· 小象传（逐爻释爻辞）· 吉/中/凶标签（384 爻全有）—— 前三者取自古籍与开源数据集，可查证；<b>「白话」一栏是本平台撰述</b>，不是原文，用来自查意思有没有读反。')"></li>
            <li v-html="t('<b>剩余期内择日</b>：⚠️ 黄历里没有「宜抽卡」，本页把它映射到最接近的「求财 / 开市 / 纳财 / 交易」—— <b>这个映射是本平台定的，不是古法</b>。日家打分只用《协纪辨方书》体系里的黄黑道、建除十二神、二十八宿、宜忌与吉神凶煞，档位阈值按分位数标定。择吉是传统口径，<b>与抽卡概率无关</b>。')"></li>
            <li v-html="t('⚠️ 本页是<b>娱乐与自我参照</b>用途，不构成任何消费建议。抽卡结果由游戏的概率系统决定，与占卜无关。保底状态需要你自己确认 —— 记录里没有「上一个金是不是当期」的可靠字段，硬猜就是循环论证。')"></li>
          </ul>
        </div>
      </template>
    </div>
    `,
  };
})();
