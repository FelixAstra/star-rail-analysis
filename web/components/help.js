// ─────────────────────────────────────────────────────────────────────────────
// 「解释说明」页 —— 把原先散在「抽卡分析」页各板块的长段解释文字集中到这里
// 组织方式：先一个「一分钟看懂」，再按「数据来源 → 卡池 → 读数 → 对账 → 维护」的
// 认知顺序排 9 章，每章 = 一句话结论 + 正文 + 界面截图 + 关键点。顶部有目录可跳转。
// 说明：正文里的实时数字随数据变，截图是 2026-09-16 的界面快照（图注里都标了）。
//
// ⚠️ 双语写法与其他页面不同，理由写在这里，改之前先读：
//    其余页面是**短标签**，走 t() + web/i18n.dict.js（中文原文当 key，译文集中放一个文件）。
//    本页是**成段的长说明文字**，一律用全局混入的 L(中文, 英文)，中英**贴着写在同一行**：
//      ① 几百行长文翻到另一个文件里去改，改一处的成本太高，也容易中英走散；
//      ② 这一页的中文原文本身就是「要讲什么」的一部分，拆开会让源码没法读。
//    代价：tools/check-i18n.js 的 t() 扫描覆盖不到本文件 —— 所以那边补了一条 L(…) 成对
//    检查（英文侧不得为空、不得含中文），运行时还有 tools/verify-i18n.js 扫 DOM 残留。
//    ⚠️ 句子中间夹着实时数字的（中英语序不同，不能靠在模板里插 {{ }} 拼），统一收在
//       下方 guide 段的方法里各自拼一整句，模板只负责 v-html。改那组方法时**别动里面的
//       数据表达式**，它们与 core/analyze.js 的输出字段一一对应。
//    ⚠️ 英文里的撇号一律写 ’（U+2019），不写 ASCII 单引号 —— 模板是反引号字符串，
//       ASCII 撇号会与 L('…','…') 的引号打架。
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const W = window.W = window.W || {};

  // 目录：章节号 / 锚点 / 中英两版标题 / 中英两版一句话
  const TOC = [
    { n: '1', id: 'hp-1', zh: '这套数字从哪来', en: 'Where these numbers come from',
      szh: '四种数据来源与各自的可信范围', sen: 'Four sources, and what each can be trusted for' },
    { n: '2', id: 'hp-2', zh: '六个卡池与两条端点', en: 'Six warp types, two endpoints',
      szh: '联动池为什么普通链接永远拿不到', sen: 'Why a normal link never returns the collab banners' },
    { n: '3', id: 'hp-3', zh: '保留期是滑动窗口', en: 'Retention is a sliding window',
      szh: '为什么必须持续同步、并集合并', sen: 'Why you must keep syncing and merge by union' },
    { n: '4', id: 'hp-4', zh: 'gacha_id 才是「哪一池」', en: 'gacha_id is what says “which banner”',
      szh: '时间区间不等于在架时长', sen: 'A time range is not how long the banner ran' },
    { n: '5', id: 'hp-5', zh: '出金明细怎么读', en: 'Reading the 5★ detail',
      szh: '池内第几抽 · 真实保底 · 吉凶', sen: 'warp # in banner · true pity · auspiciousness' },
    { n: '6', id: 'hp-6', zh: '角色管理怎么读', en: 'Reading the Characters page',
      szh: '星魂 / 叠影 / 三源合并 / 光锥归属', sen: 'Eidolons / superimposition / merging three sources / light cone attribution' },
    { n: '7', id: 'hp-7', zh: '这几个数字怎么算', en: 'How these numbers are computed',
      szh: '总抽数 · 出金率 · 每 UP · 小保底不歪', sen: 'total warps · 5★ rate · warps per UP · 50/50 win rate' },
    { n: '8', id: 'hp-8', zh: '吉凶是怎么算的', en: 'How the auspiciousness rating works',
      szh: '万年历日家 / 时家黄黑道', sen: 'almanac day and hour indicators' },
    { n: '9', id: 'hp-9', zh: '日常维护手册', en: 'Routine maintenance',
      szh: '抽了新卡、重新截了工坊页之后做什么', sen: 'what to do after pulling new warps or re-screenshotting the workshop' },
  ];

  W.HelpPage = {
    props: { a: Object },
    inject: ['goto'],
    setup() {
      return { TOC };
    },
    computed: {
      o() { return this.a.overview; },
      r() { return this.a.overview.recent; },
      d() { return this.a.audit.detail; },
      gq() { return this.a.gqCheck; },
      ldBounds() { return this.a.poolBounds.filter(p => p.isLd); },
      firstImp() { return (this.a.imports && this.a.imports[0]) || null; },
      impN() { return (this.a.imports || []).length; },
    },
    methods: {
      // 实时取某池的「当前已垫 / 窗口内记录数」，避免写死在文案里
      boundsOf(gt) { const p = this.a.poolBounds.find(x => x.gt === gt); return p ? p.cur : '—'; },
      recsOf(gt) { const p = this.a.poolBounds.find(x => x.gt === gt); return p ? p.n : 0; },
      // 导入时间戳（ISO）→ 本地可读
      ts(v) { return String(v || '').slice(0, 19).replace('T', ' ') || '—'; },

      // ── 中文 / 英文各拼一整句（句子中间夹着实时数字的那些）────────────────────
      // 这些方法里的数据表达式与 core/analyze.js 的输出字段一一对应，**只该改文案**。
      // 人物名走 this.n()，这样英文模式显示的是官方英文名（见 web/i18n.js 的 N2E）。
      gApiEdge() {
        return this.L(
          '只保留约 180 天 ~ 1 年；<b>普通池本账号最早只到 ' + this.o.retentionEdge + '</b>',
          'Only about 180 days to a year is kept; <b>for this account the standard warps reach back only to ' + this.o.retentionEdge + '</b>');
      },
      gLdEdge() {
        return this.L(
          '保留期更长，本账号能回溯到 <b>' + this.o.ldEdge + '</b>',
          'A longer retention — this account reaches back to <b>' + this.o.ldEdge + '</b>');
      },
      gTotTotal() {
        const o = this.o;
        const tailZh = o.inc.p ? '＋ 那之后新导入的 <b>' + o.inc.p + '</b> 抽' : '（目前没有晚于它的新记录）';
        const tailEn = o.inc.p ? ' plus <b>' + o.inc.p + '</b> warps imported after it' : ' (nothing newer than it yet)';
        return this.L(
          '＝ <b>数据补填</b>的总量 <b>' + o.wsBase.pulls + '</b>（快照时刻 ' + o.wsAt + '）' + tailZh + '。'
            + '<b>这是「账号全部历史」的口径</b> —— 本机自己做不完这件事，因为接口早就把早期记录删了，'
            + '所以总量改成<b>人工补填</b>（「数据管理 → ④ 数据补填」）。',
          '= the <b>manually backfilled</b> total of <b>' + o.wsBase.pulls + '</b> (snapshot at ' + o.wsAt + ')' + tailEn + '. '
            + '<b>This is the “whole account history” figure</b> — this machine cannot produce it on its own, because the API '
            + 'deleted the early records long ago, so the totals are <b>entered by hand</b> (Data → ④ Backfill totals).');
      },
      gRecentTotal() {
        const r = this.r;
        return this.L(
          '＝ <b>本地仓全部导入记录</b>（起点 <b>' + r.from + '</b>，引擎自动取最早一条、<b>不可修改</b>）：'
            + '角色活动 ' + r.byPool.ch + ' ＋ 光锥活动 ' + r.byPool.lc + ' ＋ 群星 ' + r.byPool.std + ' ＋ 联动 ' + r.byPool.ld + '。'
            + '<b>这是「可以逐条验证」的口径</b> —— 出金率、每 UP、小保底不歪都基于它，所以每导入一次就自动更新。',
          '= <b>every record in the local store</b> (start <b>' + r.from + '</b>, taken automatically from the earliest record and <b>not editable</b>): '
            + 'character event ' + r.byPool.ch + ' + light cone event ' + r.byPool.lc + ' + stellar ' + r.byPool.std + ' + collab ' + r.byPool.ld + '. '
            + '<b>This is the definition you can verify row by row</b> — the 5★ rate, warps per UP and the 50/50 win rate all rest on it, '
            + 'so it is recomputed on every import.');
      },
      gRateThree() {
        const r = this.r;
        return this.L(
          '<b>出金率</b>给了三个数：<b>' + r.rate + '%</b>（本地记录含联动）· <b>' + r.noLd.rate + '%</b>（剔除联动，与常规池可比）· '
            + '<b>' + r.fullRate + '%</b>（工坊全量口径）。三者同量级即说明解析无误；'
            + '<b>联动池出金规则不同</b>（不存在「歪到常驻」），所以不要只引用其中一个。',
          '<b>The 5★ rate</b> comes in three flavours: <b>' + r.rate + '%</b> (local records, collab included) · <b>' + r.noLd.rate + '%</b> '
            + '(collab excluded, so comparable with regular banners) · <b>' + r.fullRate + '%</b> (the workshop’s all-history basis). '
            + 'Agreement in magnitude means the parsing is sound; <b>collab banners follow different 5★ rules</b> (there is no “lost 50/50” '
            + 'there), so never quote just one of them.');
      },
      gRecentStart() {
        const r = this.r;
        return this.L(
          '<b>「近期总抽数」的起点是自动的</b>：永远等于本地仓最早的一条记录（本账号 <b>' + r.from + '</b>，联动池首抽）。'
            + '随着你持续导入，这个起点只会往左固定下来，不会因为接口滑动而漂移。',
          '<b>The start of the “recent total warps” window is automatic</b>: it is always the earliest record in the local store '
            + '(for this account <b>' + r.from + '</b>, the first collab warp). As you keep importing, that start only ever moves left and '
            + 'then sticks — it never drifts back out with the API window.');
      },
      gLdWarn() {
        const a = this.recsOf('21'), b = this.recsOf('22');
        return this.L(
          '<b>⚠️ 联动池用普通链接抓，永远返回 0 条 —— 而且不报错。</b>它的 <code>gacha_type</code> 是 21/22，但 <code>getGachaLog</code> '
            + '这个端点根本不返回它们，必须换成 <code>…/api/getLdGachaLog</code>。表现是<b>静默的空列表</b>，和「你没抽过联动池」长得一模一样。'
            + '平台在抓取时对六个池分别走对应端点，所以你能看到联动角色池那 <b>' + a + '</b> 条（含' + this.n('远坂凛') + '）与联动光锥池那 <b>' + b + '</b> 条记录。',
          '<b>⚠️ Fetching the collab warps through a normal link always returns zero rows — and reports no error.</b> Their '
            + '<code>gacha_type</code> is 21/22, but the <code>getGachaLog</code> endpoint never returns them; you have to switch to '
            + '<code>…/api/getLdGachaLog</code>. The symptom is a <b>silently empty list</b>, indistinguishable from “you never pulled on the '
            + 'collab banner”. When fetching, the platform routes each of the six warp types to its own endpoint, which is why you can see those '
            + '<b>' + a + '</b> collab character records (including ' + this.n('远坂凛') + ') and <b>' + b + '</b> collab light cone records.');
      },
      gColRecs11() {
        return this.L(
          '本地仓里该池的条数 —— <b>窗口内能拿到的那部分</b>。角色活动池现在是 <b>' + this.recsOf('11') + '</b> 条',
          'How many rows the local store holds for this banner — <b>the part inside the window</b>. The character event banner currently has <b>' + this.recsOf('11') + '</b>');
      },
      gColRange() {
        return this.L(
          '该池能回溯到的第一条与最新一条<b>抽卡时间</b>，也就是滑动窗口的左右端（本账号普通池最早只到 <b>' + this.o.retentionEdge + '</b>）',
          'The <b>warp times</b> of the earliest and latest record the banner can reach, i.e. the two edges of the sliding window '
            + '(for this account the standard warps reach back only to <b>' + this.o.retentionEdge + '</b>)');
      },
      gColGold() {
        return this.L(
          '该池窗口内出过几颗金（群星跃迁现在是 <b>' + this.gq.n + '</b> 颗）',
          'How many 5★ dropped inside this banner’s window (the Stellar Warp currently has <b>' + this.gq.n + '</b>)');
      },
      gFirstImp() {
        const f = this.firstImp;
        return this.L(
          '<b>第一次导入</b>：把当时接口窗口内的全部记录收进本地仓，这就是仓的起点 —— '
            + '本账号首次导入是 <b>' + this.ts(f ? f.at : '') + '</b>，一次入库 <b>' + (f ? f.incoming : 0) + '</b> 条。',
          '<b>The first import</b>: everything inside the API window at that moment goes into the local store, and that becomes its starting '
            + 'point — for this account the first import was <b>' + this.ts(f ? f.at : '') + '</b>, adding <b>' + (f ? f.incoming : 0) + '</b> records.');
      },
      gImpResult() {
        return this.L(
          '<b>结果</b>：本地仓<b>只会变长</b>，起点只往左固定、不会因为接口滑动而漂移。'
            + '目前已经导入 <b>' + this.impN + '</b> 次，本地仓共 <b>' + this.d.list.length + '</b> 条'
            + '[' + this.a.dataRange.from.slice(0, 10) + ' → ' + this.a.dataRange.to.slice(0, 10) + ']。',
          '<b>The result</b>: the local store <b>only ever grows</b>; the start moves left and sticks, and never drifts with the API window. '
            + 'So far <b>' + this.impN + '</b> imports have been made and the store holds <b>' + this.d.list.length + '</b> records '
            + '[' + this.a.dataRange.from.slice(0, 10) + ' → ' + this.a.dataRange.to.slice(0, 10) + '].');
      },
      gBannerCoverage() {
        const c = this.a.bannersCoverage;
        return this.L(
          '平台<b>从数据反推</b> UP（当期抽到最多的那个五星即 UP）：角色池 <b>' + c.ch.infer + '/' + c.ch.total
            + '</b> 个池、光锥池 <b>' + c.lc.infer + '/' + c.lc.total + '</b> 个池推得出来。',
          'UP is <b>inferred from the data</b> (the 5★ pulled most often inside a banner is taken to be its featured one): that works for '
            + '<b>' + c.ch.infer + '/' + c.ch.total + '</b> character banners and <b>' + c.lc.infer + '/' + c.lc.total + '</b> light cone banners.');
      },
      gTotEq() {
        const o = this.o;
        return this.L(
          '总抽数 <b>' + o.tot.p + '</b> ＝ 补填 <b>' + o.wsBase.pulls + '</b>（快照时刻 <b>' + o.wsAt + '</b>）'
            + '＋ 晚于快照时刻新导入的 <b>' + o.inc.p + '</b> 抽　·　五星 <b>' + o.tot.g + '</b> 同理',
          'Total warps <b>' + o.tot.p + '</b> = backfilled <b>' + o.wsBase.pulls + '</b> (snapshot at <b>' + o.wsAt + '</b>) '
            + '+ the <b>' + o.inc.p + '</b> warps imported after that instant · the same holds for the 5★ count, <b>' + o.tot.g + '</b>');
      },
      gRateEq() {
        const r = this.r;
        return this.L(
          '出金率 <b>' + r.rate + '%</b> ＝ 本地记录 <b>' + r.g + '</b> 金 ÷ <b>' + r.p + '</b> 抽（起点 <b>' + r.from + '</b>，自动取本地最早一条）',
          '5★ rate <b>' + r.rate + '%</b> = <b>' + r.g + '</b> 5★ from local records ÷ <b>' + r.p + '</b> warps (start <b>' + r.from + '</b>, '
            + 'taken automatically from the earliest local record)');
      },
      gRateCompare() {
        const r = this.r;
        return this.L(
          '同时给两个对照：<b>剔除联动后的 ' + r.noLd.rate + '%</b>（' + r.noLd.p + ' 抽 / ' + r.noLd.g + ' 金，与常规池可比）'
            + '与<b>工坊全量口径的 ' + r.fullRate + '%</b>。三者同量级即说明解析无误 —— '
            + '<b>联动池的出金规则不同</b>（限定池，不存在「歪到常驻」），所以不要只引用其中一个。',
          'Two comparators are given alongside it: <b>' + r.noLd.rate + '% once collab warps are removed</b> (' + r.noLd.p + ' warps / '
            + r.noLd.g + ' 5★, comparable with regular banners) and <b>' + r.fullRate + '% on the workshop’s all-history basis</b>. Agreement in '
            + 'magnitude means the parsing is sound — <b>collab banners follow different 5★ rules</b> (a limited pool has no “lost 50/50”), '
            + 'so never quote just one of them.');
      },
      gPerUpEq() {
        const d = this.d;
        return this.L(
          '每 UP 角色需 <b>' + d.perUpCh + '</b> 抽 ＝ (角色池记录 ' + d.n11 + ' − UP ' + d.linkChUp + ' 次) ÷ ' + d.linkChUp + '　·　'
            + '光锥 <b>' + d.perUpLc + '</b> 抽 ＝ (' + d.n12 + ' − ' + d.linkLcUp + ') ÷ ' + d.linkLcUp,
          'Warps per UP character <b>' + d.perUpCh + '</b> = (character pool records ' + d.n11 + ' − ' + d.linkChUp + ' UPs) ÷ ' + d.linkChUp
            + '　·　light cone <b>' + d.perUpLc + '</b> = (' + d.n12 + ' − ' + d.linkLcUp + ') ÷ ' + d.linkLcUp);
      },
      gSmallEq() {
        const d = this.d;
        return this.L(
          '角色 <b>' + d.smallCh.rate + '%</b> ＝ (UP ' + d.smallCh.up + ' − 歪 ' + d.smallCh.off + ') ÷ ' + d.smallCh.up + '　·　'
            + '光锥 <b>' + d.smallLc.rate + '%</b> ＝ (UP ' + d.smallLc.up + ' − 歪 ' + d.smallLc.off + ') ÷ ' + d.smallLc.up,
          'Character <b>' + d.smallCh.rate + '%</b> = (UP ' + d.smallCh.up + ' − lost ' + d.smallCh.off + ') ÷ ' + d.smallCh.up + '　·　'
            + 'light cone <b>' + d.smallLc.rate + '%</b> = (UP ' + d.smallLc.up + ' − lost ' + d.smallLc.off + ') ÷ ' + d.smallLc.up);
      },
      gSmallDef() {
        const d = this.d;
        return this.L(
          '<b>定义：</b>抽到的 UP 里，有多少次是<b>小保底直接出</b>（而不是「先歪常驻、下一个金才必出 UP」的大保底兑现）。'
            + '算法就是把该池的<b>歪次数从 UP 次数里减掉</b> —— 因为每一次歪都会被随后的一个 UP 兑现：'
            + '角色池 <b>' + d.smallCh.up + ' 个 UP 里，' + d.smallCh.off + ' 个是大保底兑现、剩下 ' + d.smallCh.direct + ' 个是小保底直出</b>。',
          '<b>Definition:</b> of the UP 5★ you pulled, how many came <b>straight off the 50/50</b> rather than as a redeemed guarantee '
            + '(“lose to a standard 5★ first, then the next 5★ must be the featured one”). The arithmetic simply <b>subtracts the losses from '
            + 'the UP count</b>, because every loss is redeemed by a later UP: of the character pool’s <b>' + d.smallCh.up + ' UPs, '
            + d.smallCh.off + ' were redeemed guarantees and the remaining ' + d.smallCh.direct + ' came straight off the 50/50</b>.');
      },
      gBackfillHow() {
        return this.L(
          '接口保留期之外那段来自你给的工坊截图：先用本地图标库对每个头像做<b>模板匹配</b>，再把匹配结果与截图裁切'
            + '<b>并排放大逐行目视核对</b>；另用「抽数条的像素宽与抽数成线性」做交叉校验（最小二乘拟合残差 0.0 ~ 0.4px 即读数无误）。'
            + '「歪」沿用截图上的红色印章，不做二次推断。衔接自洽性也验过：截图段共 <b>' + this.d.histOff + '</b> 次「歪」，'
            + '时间上紧跟其后的那个金<b>全部是 UP</b>，与「歪之后下一个金必是 UP」一致。',
          'The stretch before the API retention window comes from the workshop screenshots you supplied: every avatar is <b>template-matched</b> '
            + 'against the local icon library, then the match is blown up side by side with the screenshot crop and <b>checked by eye row by row</b>; '
            + 'a cross-check uses the fact that the warp-count bar’s pixel width is linear in the warp count (a least-squares residual of 0.0–0.4px '
            + 'means the reading is correct). “Lost” follows the red stamp in the screenshot and is never re-inferred. The seam has been checked for '
            + 'consistency too: the screenshots contain <b>' + this.d.histOff + '</b> losses, and in every case the next 5★ in time <b>was the featured one</b>, '
            + 'matching “after a loss, the next 5★ must be the UP”.');
      },
      gPerUpNote() {
        return this.L(
          '<code>(池抽数 − UP 数) ÷ UP 数</code>，数据 = 本地 ' + this.d.list.length + ' 条记录',
          '<code>(banner warps − UPs) ÷ UPs</code>, from ' + this.d.list.length + ' local records');
      },
      gGoldRowNote() {
        const p = this.gq.pities.join(' / ');
        return this.L(
          '这几颗金在接口里逐条可见，抽数 <b>' + p + '</b> 与截图补录<b>完全相等</b>',
          'These 5★ are all visible in the API, and their warp counts — <b>' + p + '</b> — are <b>exactly equal</b> to the screenshot backfill');
      },
      gOldestCell() {
        const nm = this.n(this.gq.oldestName);
        return this.L('最旧那颗「' + nm + '」', 'The oldest of them, “' + nm + '”');
      },
      gOldestGold() {
        const g = this.gq;
        return this.L(
          '接口只看到其中 <b>' + g.inWin + '</b> 抽，剩下 <b>' + g.carry + '</b> 抽垫在保留期之外、截图里才有 → 合起来 ' + g.full + ' 抽',
          'The API can only see <b>' + g.inWin + '</b> of those warps; the other <b>' + g.carry + '</b> were pity built up outside the retention '
            + 'window and exist only in the screenshots → ' + g.full + ' warps in total');
      },
      gDedup() {
        const d = this.d;
        return this.L(
          '<b>剔重的三处</b>：工坊截图是<b>最新在上</b>（倒序），最上面几行其实已经落在接口窗口内 —— '
            + '角色池「' + this.n('姬子') + ' 74 抽」＝ 窗口内 <code>2092</code> 池第 60 抽那条；'
            + '角色池「' + this.n('长夜月') + ' 76 抽」与光锥池「' + this.n('时节不居') + ' 50 抽」的保底<b>跨窗口边界</b>'
            + '（链接里只看得到 <b>' + d.crossPity.ch + ' / ' + d.crossPity.lc + '</b> 抽），截图给的是完整值（76 / 50）。'
            + '三处都<b>只算一次</b>，否则同一笔抽卡会被算两遍。',
          '<b>Three places need de-duplicating</b>: the workshop screenshots run <b>newest first</b> (reverse order), so the top few rows actually '
            + 'fall inside the API window — the character pool’s “' + this.n('姬子') + ', 74 warps” is the warp-60 row of banner <code>2092</code> inside '
            + 'the window; and the pity for the character pool’s “' + this.n('长夜月') + ', 76 warps” and the light cone pool’s “'
            + this.n('时节不居') + ', 50 warps” <b>crosses the window edge</b> (the link only shows <b>' + d.crossPity.ch + ' / ' + d.crossPity.lc
            + '</b> of it), while the screenshots give the full value (76 / 50). All three are counted <b>once only</b> — otherwise the same warps '
            + 'would be counted twice.');
      },
      gPityInput() {
        return this.L(
          '<b>「已垫 N 抽」是最容易写错的输入</b>：每个池的「当前已垫」直接加进该池总量（定义见第 2 章）。'
            + '本账号曾因为把常驻跃迁的已垫写成 50（实际 51）而<b>正好差 1 抽</b>。'
            + '正确做法：<b>该值必须能用接口自算复核</b> —— 该池窗口内最后一个五星之后的记录条数就是当前已垫'
            + '（角色 ' + this.boundsOf('11') + ' / 光锥 ' + this.boundsOf('12') + ' / 常驻 <b>' + this.boundsOf('1') + '</b> 抽）。',
          '<b>“N warps into pity” is the input most easily got wrong</b>: each banner’s current pity is added straight into that banner’s total '
            + '(definition in chapter 2). This account was off by <b>exactly one warp</b> because the Stellar Warp’s pity was written as 50 when it '
            + 'was really 51. The right approach: <b>the value must be reproducible from the API itself</b> — the number of records after the last 5★ '
            + 'inside that banner’s window <b>is</b> the current pity (character ' + this.boundsOf('11') + ' / light cone ' + this.boundsOf('12')
            + ' / stellar <b>' + this.boundsOf('1') + '</b>).');
      },
    },
    template: `
    <div class="wrap hp">
      <div class="pagehead">
        <div>
          <h1>{{ L('解释说明', 'Guide') }}</h1>
          <div class="sub" v-html="L('这一页是<b>说明书</b>：把「抽卡分析」「角色管理」里每一块数字的<b>来源、口径、坑</b>讲清楚。数字会随数据变，<b>截图是 2026-09-16 的界面快照</b>，只作示意。', 'This page is the <b>manual</b>: it spells out the <b>source, definition and pitfalls</b> of every block of numbers on the Analysis and Characters pages. The figures move with your data — <b>the screenshots are snapshots of the 2026-09-16 UI</b> and are for illustration only.')"></div>
        </div>
        <div class="pg-actions">
          <button class="btn" @click="goto('analysis')">{{ L('← 回 抽卡分析', '← Back to Analysis') }}</button>
          <button class="btn" @click="goto('roles')">{{ L('✦ 去 角色管理', '✦ Characters') }}</button>
        </div>
      </div>

      <div class="hp-toc">
        <a class="hp-toc-i" v-for="it in TOC" :key="it.n" :href="'#' + it.id">
          <b class="hp-toc-n">{{ it.n }}</b>
          <span><b>{{ L(it.zh, it.en) }}</b><i>{{ L(it.szh, it.sen) }}</i></span>
        </a>
      </div>

      <div class="hp-tip" v-html="L('<b>一分钟看懂：</b>你看到的每一个数字，只会来自这四种来源之一 —— <b>① 总量补填</b>（「数据补填」里手填的总抽数 / 五星数，本机无法逐条还原，所以直接采信）· <b>② 官方抽卡接口</b>（逐条记录，但只保留约 1 年）· <b>③ 工坊截图补录</b>（把 ② 拿不到的那段从截图里读出来）· <b>④ 外部统计补录</b>（你从游戏内角色列表 / 工坊统计页等渠道截图，人工确认后的<b>当前真实持有状态</b>，只有命数、没有抽数）。前三种<b>按 <code>id</code> / <code>item_id</code> 剔重后合并</b>；而「出金率 / 每 UP / 小保底不歪」这类比率<b>只用 ② 实时计算</b>，所以每导入一次就会自动更新；<b>④ 不参与任何抽数口径</b>，只影响角色管理页的星魂 / 叠影。下面逐条讲。', '<b>In one minute:</b> every number you see comes from exactly one of these four sources — <b>① manual totals</b> (the total warps / 5★ count you type into Backfill totals; this machine cannot reconstruct them row by row, so they are taken as given) · <b>② the official warp API</b> (record by record, but only about a year is retained) · <b>③ workshop screenshot backfill</b> (reading the stretch ② cannot reach out of screenshots) · <b>④ external stats</b> (a screenshot from the in-game character list, a workshop stats page or similar, confirmed by hand, giving your <b>current real holdings</b> — Eidolon / superimposition levels only, no warp counts). The first three are <b>de-duplicated by <code>id</code> / <code>item_id</code> and then merged</b>; rates such as the 5★ rate, warps per UP and the 50/50 win rate are <b>computed live from ② only</b>, so they refresh on every import; <b>④ feeds no warp-count figure at all</b> and only affects Eidolons / superimposition on the Characters page. Details follow.')"></div>

      <!-- ① ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-1">{{ L('1 · 这套数字从哪来', '1 · Where these numbers come from') }} <small>{{ L('四种来源，各自的可信范围不同', 'four sources, trusted to four different degrees') }}</small></h2>
        <p class="hp-p" v-html="L('抽卡数据有四条来路，<b>可信范围和粒度都不一样</b>。平台的原则是：<b>能用逐条记录算的，绝不采信总数；逐条记录拿不到的，才用工坊快照和截图补录兜底。</b>', 'Warp data reaches this machine along four routes, <b>each with its own granularity and level of trust</b>. The principle here is simple: <b>whenever a per-record computation is possible, never fall back on an aggregate; only fall back on workshop snapshots and screenshot backfill for what per-record data can no longer reach.</b>')"></p>
        <table class="tb">
          <thead><tr><th>{{ L('来源', 'Source') }}</th><th>{{ L('给什么', 'What it provides') }}</th><th>{{ L('粒度', 'Granularity') }}</th><th>{{ L('边界', 'Limits') }}</th></tr></thead>
          <tbody>
            <tr><td>{{ L('官方接口', 'Official API') }}<br><span class="dim2">getGachaLog</span></td>
              <td>{{ L('逐条记录（含时间、物品、星级）', 'Record by record (time, item, rarity)') }}</td>
              <td>{{ L('一条不差', 'Row-exact') }}</td>
              <td v-html="gApiEdge()"></td></tr>
            <tr><td>{{ L('官方联动接口', 'Official collab API') }}<br><span class="dim2">getLdGachaLog</span></td>
              <td>{{ L('联动池（21/22）逐条记录', 'Record by record for the collab banners (21/22)') }}</td>
              <td>{{ L('一条不差', 'Row-exact') }}</td>
              <td v-html="gLdEdge()"></td></tr>
            <tr><td>{{ L('总量补填', 'Manual totals') }}<br><span class="dim2">{{ L('数据管理 → ④', 'Data → ④') }}</span></td>
              <td v-html="L('<b>只有总量</b>（总抽数 / 五星数）', '<b>Totals only</b> (total warps / 5★ count)')"></td>
              <td>{{ L('两个汇总数', 'Two summary numbers') }}</td>
              <td>{{ L('人工填；以后每次导入都会在它之上叠加新增', 'Entered by hand; every later import adds its new records on top') }}</td></tr>
            <tr><td>{{ L('工坊截图补录', 'Workshop screenshot backfill') }}</td>
              <td>{{ L('窗口外那段的历史跃迁明细', 'The historical warp detail from before the window') }}</td>
              <td>{{ L('每行一位五星 + 抽数', 'One 5★ per row, plus its warp count') }}</td>
              <td v-html="L('人工读数，只能补「五星那一行」的信息；<b>只服务角色管理页</b>', 'Read off by hand, and only able to supply the “5★ row”; <b>it feeds the Characters page only</b>')"></td></tr>
            <tr><td>{{ L('外部统计补录', 'External stats') }}<br><span class="dim2">{{ L('数据管理 → ⑤', 'Data → ⑤') }}</span></td>
              <td v-html="L('<b>只有命数</b>（星魂 / 叠影等级）与持有清单', '<b>Eidolon / superimposition levels only</b>, plus what you own')"></td>
              <td>{{ L('每个角色 / 光锥一个数', 'One number per character / light cone') }}</td>
              <td v-html="L('上传截图 → 本机图标匹配预填 → 人工确认；<b>语义是真值快照，覆盖旧值</b>，见 6.1', 'Upload a screenshot → local icon matching pre-fills the table → you confirm by hand; <b>semantically a ground-truth snapshot that overwrites older values</b>, see 6.1')"></td></tr>
          </tbody>
        </table>
        <p class="hp-p">{{ L('于是有了两条不同口径的「总抽数」，别混着看：', 'That leaves you with two “total warps” figures under different definitions — do not mix them up:') }}</p>
        <div class="hp-two">
          <div class="hp-card">
            <div class="hp-card-h">{{ L('数据总貌 · 总抽数', 'Data overview · total warps') }} <b>{{ o.tot.p }}</b></div>
            <div class="hp-card-b" v-html="gTotTotal()"></div>
          </div>
          <div class="hp-card">
            <div class="hp-card-h">{{ L('数据总貌 · 近期总抽数', 'Data overview · recent total warps') }} <b>{{ r.p }}</b></div>
            <div class="hp-card-b" v-html="gRecentTotal()"></div>
          </div>
        </div>
        <figure class="hp-fig">
          <img src="assets/help/01-summary.png" loading="lazy" :alt="L('抽卡总结示意图', 'Sample warp summary')">
          <figcaption v-html="L('<b>图 1</b>　第三方统计工具或游戏内总结页上一般能看到<b>总抽数</b>与<b>五星数</b>这两个汇总数（图中为演示数据的示意图）。平台的「数据补填」只读这两个数当基准；其余几项（平均出金、每 UP、小保底不歪）由平台基于<b>本地导入的记录</b>自行计算，口径见第 7 章。', '<b>Figure 1</b> A third-party tracker or the in-game summary page normally shows the two aggregates — <b>total warps</b> and <b>5★ count</b> (the illustration uses demo data). The platform’s backfill reads only those two numbers as its baseline; every other figure (average warps per 5★, warps per UP, 50/50 win rate) is computed here from the <b>locally imported records</b>, with the definitions given in chapter 7.')"></figcaption>
        </figure>
        <figure class="hp-fig">
          <img src="assets/help/02-overview.png" loading="lazy" :alt="L('数据总貌卡片', 'Data overview cards')">
          <figcaption v-html="L('<b>图 2</b>　平台的「数据总貌」。每张卡片下面那行小字就是它的口径（点「解释说明」随时回来查）。', '<b>Figure 2</b> The platform’s “Data overview”. The small line under each card states its definition (come back to this Guide whenever you need to look one up).')"></figcaption>
        </figure>
        <div class="hp-kv">
          <b>{{ L('要点', 'Key points') }}</b>
          <ul>
            <li v-html="gRateThree()"></li>
            <li v-html="L('<b>两种口径不要混用</b>：总量（总抽数 / 五星数）来自<b>补填</b>，比率（出金率 / 每 UP / 小保底不歪）来自<b>本地导入记录</b> —— 两者的分母本来就不一样，不是数据矛盾。每张卡片下方那行小字都写了它自己的口径，详见第 7 章。', '<b>Never mix the two definitions</b>: the totals (total warps / 5★ count) come from <b>manual backfill</b>, while the rates (5★ rate / warps per UP / 50/50 win rate) come from the <b>locally imported records</b> — the two have different denominators by construction, which is not a data conflict. The small line under each card states its own definition; see chapter 7 for the details.')"></li>
            <li v-html="gRecentStart()"></li>
          </ul>
        </div>
      </section>

      <!-- ② ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-2">{{ L('2 · 六个卡池与两条端点', '2 · Six warp types, two endpoints') }} <small>{{ L('保底各自独立，统计不能合并成一条链', 'each keeps its own pity, so the stats cannot be chained together') }}</small></h2>
        <p class="hp-p" v-html="L('一个账号的抽卡记录由 <b>6 个池</b>组成，<b>保底各自独立、互不共享</b>（角色池 90 抽、光锥池 80 抽、新手池 50 抽封顶）：', 'An account’s warp history consists of <b>six pools</b>, whose <b>pity counters are separate and never shared</b> (character pool 90 warps, light cone pool 80, departure pool capped at 50):')"></p>
        <table class="tb">
          <thead><tr><th>{{ L('卡池', 'Banner') }}</th><th class="hn">gacha_type</th><th>{{ L('记录从哪来', 'Where the records come from') }}</th></tr></thead>
          <tbody>
            <tr><td>{{ L('角色活动跃迁', 'Character Event Warp') }}</td><td class="num">11</td><td>{{ L('普通链接（仅窗口内）', 'Normal link (inside the window only)') }}</td></tr>
            <tr><td>{{ L('光锥活动跃迁', 'Light Cone Event Warp') }}</td><td class="num">12</td><td>{{ L('普通链接（仅窗口内）', 'Normal link (inside the window only)') }}</td></tr>
            <tr><td>{{ L('群星跃迁（常驻）', 'Stellar Warp (standard)') }}</td><td class="num">1</td><td v-html="L('普通链接，但<b>只有窗口内那部分</b>（本账号窗口内 233 抽）', 'A normal link, but <b>only the part inside the window</b> (233 warps for this account)')"></td></tr>
            <tr><td>{{ L('始发跃迁（新手）', 'Departure Warp (beginner)') }}</td><td class="num">2</td><td>{{ L('50 抽封顶、老账号早已抽完 → 接口返回空，只能靠截图', 'Capped at 50 warps and long since finished on an old account → the API returns nothing, so screenshots are the only source') }}</td></tr>
            <tr><td>{{ L('角色联动跃迁', 'Character Collaboration Warp') }}</td><td class="num">21</td><td v-html="L('<b>另一条端点 <code>getLdGachaLog</code></b>', '<b>The other endpoint, <code>getLdGachaLog</code></b>')"></td></tr>
            <tr><td>{{ L('光锥联动跃迁', 'Light Cone Collaboration Warp') }}</td><td class="num">22</td><td>{{ L('同上', 'Same as above') }}</td></tr>
          </tbody>
        </table>
        <div class="hp-warn" v-html="gLdWarn()"></div>
        <figure class="hp-fig">
          <img src="assets/help/03-pool-bounds.png" loading="lazy" :alt="L('各卡池时间边界表', 'Per-banner time bounds table')">
          <figcaption v-html="L('<b>图 3</b>　「各卡池时间边界」。标「另一端点」的两行走联动端点；它们的<b>跨度特别长是因为把历史上多期按 gacha_type 合并了</b>，不代表连开了一年。', '<b>Figure 3</b> “Per-banner time bounds”. The two rows marked “other endpoint” go through the collab endpoint; <b>their unusually long spans come from merging several past runs by gacha_type</b> and do not mean a year-long banner.')"></figcaption>
        </figure>
        <div class="hp-kv">
          <b>{{ L('要点', 'Key points') }}</b>
          <ul>
            <li v-html="L('「链接里缺某池」有<b>三种完全不同的原因</b>，别混：① <b>超出保留期</b>（静默空返回）② <b>该池走另一条端点</b>（联动）③ <b>真的没抽过</b>。', '“A banner is missing from the link” has <b>three completely different causes</b> — do not conflate them: ① <b>past the retention window</b> (a silent empty response) ② <b>that banner uses the other endpoint</b> (collab) ③ <b>you genuinely never pulled there</b>.')"></li>
            <li v-html="L('超期<b>不报错</b>（<code>retcode=0</code>、<code>message=OK</code>，只是 <code>list</code> 为空），所以<b>不能拿「返回条数 &lt; 请求条数」判定到底了</b>。', 'Expiry <b>reports no error</b> (<code>retcode=0</code>, <code>message=OK</code>, only an empty <code>list</code>), so <b>“returned rows &lt; requested rows” is not evidence that you have reached the end</b>.')"></li>
          </ul>
        </div>
        <p class="hp-p" v-html="L('「各卡池时间边界」那张表（现在在<b>「抓取与数据管理」页</b>）各列的含义：', 'What each column of the “Per-banner time bounds” table means (it now lives on the <b>Fetch &amp; Data page</b>):')"></p>
        <table class="tb">
          <thead><tr><th>{{ L('列', 'Column') }}</th><th>{{ L('含义', 'Meaning') }}</th></tr></thead>
          <tbody>
            <tr><td style="white-space:nowrap"><b>{{ L('记录数', 'Records') }}</b></td>
              <td v-html="gColRecs11()"></td></tr>
            <tr><td style="white-space:nowrap"><b>{{ L('最早 / 最晚', 'Earliest / latest') }}</b></td>
              <td v-html="gColRange()"></td></tr>
            <tr><td style="white-space:nowrap"><b>{{ L('跨度', 'Span') }}</b></td>
              <td v-html="L('＝ 最晚 − 最早，<b>不是卡池在架时长</b>。联动池那两行跨一年，是因为它把历史上多期按 <code>gacha_type</code> 合并了，不代表连开一年', '= latest − earliest, <b>not how long the banner was live</b>. The two collab rows span a year because several past runs are merged by <code>gacha_type</code>, not because one banner ran that long')"></td></tr>
            <tr><td style="white-space:nowrap"><b>{{ L('五星', '5★') }}</b></td>
              <td v-html="gColGold()"></td></tr>
            <tr><td style="white-space:nowrap"><b>{{ L('已垫抽数', 'Warps into pity') }}</b></td>
              <td v-html="L('<b>距该池最近一次出金之后又抽了多少抽</b>；斜杠后面是该池的<b>保底上限</b>（角色 <code>90</code> / 光锥 <code>80</code> / 新手 <code>50</code> / 常驻 <code>90</code>）。它<b>只数本池</b>，与出金明细里的「真实保底」不是一回事 —— 后者<b>跨同类型卡池累计</b>', '<b>How many warps have been made since the most recent 5★ in that banner</b>; the number after the slash is the banner’s <b>hard-pity cap</b> (character <code>90</code> / light cone <code>80</code> / beginner <code>50</code> / standard <code>90</code>). It <b>counts this banner only</b>, and is not the same thing as “true pity” in the 5★ detail — that one <b>accumulates across banners of the same type</b>')"></td></tr>
          </tbody>
        </table>
      </section>

      <!-- ③ ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-3">{{ L('3 · 保留期是「滑动窗口」', '3 · Retention is a sliding window') }} <small>{{ L('进新的、挤旧的，所以每次抓取都必须留档', 'new records push old ones out, so every fetch has to be archived') }}</small></h2>
        <p class="hp-p" v-html="L('官方接口不是「保留最近 1 年就固定不动」，而是<b>滑动窗口：来了新记录，最老的就被挤掉</b>。实测同一个账号隔一天抓两次：旧的一份 3188 条、跨度 <code>2025-09-15 → 09-14</code>；新的一份 3189 条、跨度 <code>2025-09-22 → 09-16</code> —— <b>新的条数更多，但起点右移了 7 天</b>，只读最新那份就会白丢窗口左端那条记录（实测丢过一条 <code>09-15</code> 的青雀）。', 'The official API does not “keep the last year and hold it still”; it is a <b>sliding window: a new record arrives and the oldest one is pushed out</b>. Measured on one account, two fetches a day apart: the older returned 3188 rows spanning <code>2025-09-15 → 09-14</code>, the newer 3189 rows spanning <code>2025-09-22 → 09-16</code> — <b>more rows, yet the start moved 7 days to the right</b>, so reading only the newest response silently drops the record at the left edge (a ' + 'Qingque' + ' row from <code>09-15</code> was lost that way in testing).')"></p>
        <div class="hp-two">
          <div class="hp-card">
            <div class="hp-card-h">{{ L('所以平台这么做', 'So the platform does this') }}</div>
            <div class="hp-card-b" v-html="L('每次抓回来的结果都<b>按 <code>id</code> 去重合并</b>进 <code>data/records.json</code>，原始文件另外留一份到 <code>data/snapshots/</code>。<b>取并集、永不覆盖</b> —— 每同步一次，历史左端就永久固定在最早那次抓到的位置。', 'Every fetch is <b>de-duplicated by <code>id</code> and merged</b> into <code>data/records.json</code>, and the raw response is archived separately under <code>data/snapshots/</code>. <b>Union, never overwrite</b> — each sync pins the left edge of your history at the earliest point ever fetched.')"></div>
          </div>
          <div class="hp-card">
            <div class="hp-card-h">{{ L('推论：总抽数只能「持续累积」', 'Consequence: the totals can only accumulate') }}</div>
            <div class="hp-card-b" v-html="L('一条链接<b>不可能</b>还原第三方工具的全量历史（它云端存了 5588 抽，接口只给你窗口里那 3273 条）。要做完整历史只有两条路：<b>从现在起持续同步</b>，或者<b>导入第三方导出的记录文件</b>（UIGF / SRGF 格式）。', 'A single link <b>cannot</b> rebuild a third-party tool’s full history (it holds 5588 warps in the cloud, while the API hands you only those 3273 rows inside the window). Full history takes one of two routes: <b>keep syncing from now on</b>, or <b>import a record file exported by a third-party tool</b> (UIGF / SRGF format).')"></div>
          </div>
        </div>
        <h3 class="hp-h3">{{ L('3.1 导入的完整生命周期：第一次建仓，之后只累加', '3.1 The full life of an import: the first one creates the store, the rest only add') }}</h3>
        <div class="hp-eq" v-html="L('第一次导入 → <b>建立本地仓</b>　·　之后再导入 → <b>校验 + 累计</b>（旧记录原样不动，只追加新出现的）', 'First import → <b>the local store is created</b>　·　later imports → <b>validate + accumulate</b> (existing records stay untouched; only new ones are appended)')"></div>
        <ol class="hp-ul" style="margin:0 0 12px">
          <li v-html="gFirstImp()"></li>
          <li v-html="L('<b>之后每次导入</b>：把新拿到的一批与本地仓<b>按 <code>id</code> 逐条比对</b> —— 已经存在的记录<b>原样不动</b>（重复出现就跳过），只把<b>新出现的</b>追加进去；同时在 <code>data/snapshots/</code> 留一份原始快照，事后能查「这条是哪次抓来的」。', '<b>Every import after that</b>: the newly fetched batch is <b>compared against the local store row by row, by <code>id</code></b> — existing records <b>stay exactly as they are</b> (repeats are skipped) and only <b>newly seen</b> rows are appended; at the same time a raw snapshot is kept under <code>data/snapshots/</code>, so later you can ask “which fetch brought this row in”.')"></li>
          <li v-html="gImpResult()"></li>
        </ol>
        <figure class="hp-fig">
          <img src="assets/help/08-manage.png" loading="lazy" :alt="L('抓取与数据管理页', 'Fetch & Data page')">
          <figcaption v-html="L('<b>图 4</b>　「抓取与数据管理」：贴一条抽卡链接就能增量同步，下方能看到每一次导入的来源与新增条数。', '<b>Figure 4</b> “Fetch &amp; Data”: paste a warp link and it syncs incrementally; below, you can see the source of every import and how many records it added.')"></figcaption>
        </figure>
        <div class="hp-warn" v-html="L('<b>⚠️ 抓完一整轮（6 池 ≈ 200+ 次请求）后，接口侧会临时限流</b>：整条域名连不上，但其它米哈游域名正常 —— <b>这不是断网、也不是链接（authkey）失效</b>，很容易误判成「链接过期了」。等几分钟再试即可，重试用 45 秒级的长间隔。', '<b>⚠️ After a full round (six pools ≈ 200+ requests) the API side rate-limits you temporarily</b>: the whole domain becomes unreachable while other HoYoverse domains are fine — <b>this is neither a network outage nor an expired link (authkey)</b>, though it is easily mistaken for one. Just wait a few minutes and retry; retries use long ~45-second intervals.')"></div>
      </section>

      <!-- ④ ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-4">{{ L('4 · <code>gacha_id</code> 才是「哪一池」', '4 · <code>gacha_id</code> is what says “which banner”') }} <small>{{ L('时间区间 ≠ 在架时长', 'a time range ≠ how long the banner ran') }}</small></h2>
        <p class="hp-p" v-html="L('<code>gacha_id</code> 是<b>卡池的身份编号</b>，不是时间区间。同一半期会有<b>两个并行卡池</b>同时上架，你在两池之间来回抽时，同一个 <code>gacha_id</code> 的记录就会被分成<b>不连续的多段</b>，不同 <code>gacha_id</code> 的区间还会互相重叠。所以平台<b>按 <code>gacha_id</code> 归并</b>：一个卡池只出现一行，抽数与五星构成不会被拆散（按「id 一变就切段」会把角色池虚报成 45 个池，实际只有 30 个）。', '<code>gacha_id</code> is a <b>banner’s identity number</b>, not a time range. Two banners normally run side by side in the same half-patch, so when you warp back and forth the records for one <code>gacha_id</code> break into <b>several non-contiguous stretches</b>, and different <code>gacha_id</code>s can overlap in time. The platform therefore <b>merges by <code>gacha_id</code></b>: one banner yields one row, and its warp count and 5★ composition stay intact (splitting on “the id changed” would inflate the character pool to 45 banners when there are really 30).')"></p>
        <p class="hp-p" v-html="L('表里的「<b>时间区间</b>」是<b>该池首末抽卡时间</b>（从你的记录时间戳算出来的），<b>不是卡池在架时长</b>。', 'The “<b>time range</b>” column is <b>the first and last warp time in that banner</b> (computed from your record timestamps), <b>not how long the banner was live</b>.')"></p>
        <figure class="hp-fig">
          <img src="assets/help/04-banners.png" loading="lazy" :alt="L('当期卡池识别', 'Current banner detection')">
          <figcaption v-html="L('<b>图 5</b>　「当期卡池识别」。按 gacha_id 一行一池；「来源」三色 = <span class=&quot;tg ok&quot;>出金</span> 抽到过当期 UP / <span class=&quot;tg bad&quot;>歪常驻</span> 出金但全歪 / <span class=&quot;tg dim&quot;>未出金</span>；点任意一行展开出金明细。', '<b>Figure 5</b> “Current banner detection”. One row per gacha_id; the three source colours are <span class=&quot;tg ok&quot;>Won UP</span> pulled the featured UP / <span class=&quot;tg bad&quot;>Lost 50/50</span> pulled a 5★ but always lost / <span class=&quot;tg dim&quot;>No 5★</span>; click any row to expand its 5★ detail.')"></figcaption>
        </figure>
        <div class="hp-kv">
          <b>{{ L('「当期 UP」这一列要留意', 'Mind the “Featured UP” column') }}</b>
          <ul>
            <li v-html="gBannerCoverage()"></li>
            <li v-html="L('<b>推不出来的原因是逻辑本身</b>：没抽到过 UP 就无从反推（显示「—」）。要 100% 覆盖得额外维护一张 <code>gacha_id → UP</code> 的历史表 —— <b>这是已知局限，不是数据错误</b>。', '<b>It cannot be inferred for a logical reason</b>: if you never pulled the featured 5★ there is nothing to infer from (shown as “—”). Getting to 100% coverage would mean maintaining a separate <code>gacha_id → UP</code> history table — <b>a known limitation, not a data error</b>.')"></li>
          </ul>
        </div>
      </section>

      <!-- ⑤ ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-5">{{ L('5 · 出金明细怎么读', '5 · Reading the 5★ detail') }} <small>{{ L('池内第几抽 · 真实保底 · 吉凶', 'warp # in banner · true pity · auspiciousness') }}</small></h2>
        <p class="hp-p" v-html="L('点开任意一个卡池行，展开的是<b>该池每一次出金</b>。三个数字的含义完全不同：', 'Expanding any banner row shows <b>every 5★ in that banner</b>. The three numbers mean completely different things:')"></p>
        <table class="tb">
          <thead><tr><th>{{ L('列', 'Column') }}</th><th>{{ L('含义', 'Meaning') }}</th><th>{{ L('容易误读的地方', 'Where it is easy to misread') }}</th></tr></thead>
          <tbody>
            <tr><td><b>{{ L('池内第几抽', 'warp # in banner') }}</b></td>
              <td v-html="L('只数<b>本池</b>自己的记录，这一抽在本池排第几（第 1 抽＝本池第一条记录）', 'Counts only <b>this banner’s own</b> records — where this warp sits inside the banner (warp 1 = the banner’s first record)')"></td>
              <td v-html="L('它<b>不是</b>「距上一次出金多少抽」，也<b>不能</b>用同类型池的全局序号相减去算 —— 并行池交错会把别的池的抽数累进来', 'It is <b>not</b> “how many warps since the last 5★”, and it <b>cannot</b> be derived by subtracting global indexes across banners of the same type — interleaved banners would fold another banner’s warps in')"></td></tr>
            <tr><td><b>{{ L('真实保底', 'True pity') }}</b></td>
              <td v-html="L('距<b>上一个五星</b>实际抽了多少，<b>跨同类型的卡池累计</b>（角色池与光锥池各一套，互不相通）', 'How many warps were actually made since the <b>previous 5★</b>, <b>accumulated across banners of the same type</b> (the character pool and the light cone pool each keep their own counter and never share)')"></td>
              <td v-html="L('同一行里「池内第几抽」与「真实保底」通常不同，差多少＝中间有多少抽打在了同时上架的另一个池上', 'In the same row, “warp # in banner” and “true pity” usually differ; the gap is how many warps went to the other banner running at the same time')"></td></tr>
            <tr><td><b>{{ L('吉凶', 'Auspiciousness') }}</b></td>
              <td v-html="L('按<b>出金那一刻</b>算的万年历吉凶（见第 8 章）', 'The almanac rating for <b>the instant the 5★ dropped</b> (see chapter 8)')"></td>
              <td v-html="L('同一天不同时辰的黄黑道不同，所以同一天的吉凶会变', 'The day and hour indicators differ hour by hour, so a single date can carry different ratings')"></td></tr>
          </tbody>
        </table>
        <figure class="hp-fig">
          <img src="assets/help/05-detail.png" loading="lazy" :alt="L('展开的出金明细', 'An expanded 5★ detail')">
          <figcaption v-html="L('<b>图 6</b>　展开面板：顶部胶囊是本池统计，圆点是每次出金在本池的落点（<b>UP 紫 / 歪 橙</b>），下面是明细表。', '<b>Figure 6</b> The expanded panel: the pill at the top summarises the banner, the dots mark where each 5★ landed inside it (<b>purple = UP, orange = lost</b>), and the detail table sits below.')"></figcaption>
        </figure>
        <div class="hp-kv">
          <b>{{ L('要点', 'Key points') }}</b>
          <ul>
            <li v-html="L('一整池窗口内的<b>第一金</b>，它的保底是从<b>保留期之前</b>续起来的 —— 链接里只看得到窗口内那段，明细表里显示的也是「窗口内能解析到的抽数」，会明显小于真实保底。', 'The <b>first 5★</b> inside a banner’s window carried its pity over from <b>before the retention window</b> — the link shows only the part inside the window, so the detail table also shows “the warps that can still be parsed inside the window”, which is noticeably smaller than the true pity.')"></li>
            <li v-html="L('平台有一条兜底断言：<b>任何池的「池内第几抽」最大值不得超过该池总抽数</b>；越界就直接报错，不渲染错数据。', 'There is a backstop assertion: <b>no banner’s largest “warp # in banner” may exceed that banner’s total warps</b>; an overflow errors out immediately rather than rendering bad data.')"></li>
          </ul>
        </div>
      </section>

      <!-- ⑥ ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-6">{{ L('6 · 角色管理怎么读', '6 · Reading the Characters page') }} <small>{{ L('星魂 / 叠影 / 三源合并 / 光锥归属', 'Eidolons / superimposition / three-source merge / light cone attribution') }}</small></h2>
        <p class="hp-p" v-html="L('「角色管理」页有两块：<b>五星角色 × 专属光锥</b> 与 <b>五星光锥全览</b>。它们都是<b>「接口窗口 ＋ 工坊截图补录 ＋ 外部统计补录」三个来源合并</b>后的结果 —— 只看接口会让跨期数据残缺（比如长夜月、时节不居这两条金压在窗口边界上）。', 'The Characters page has two blocks: <b>5★ characters × signature light cones</b> and <b>all 5★ light cones</b>. Both are the result of <b>merging three sources — API window + workshop screenshot backfill + external stats</b>; the API alone leaves cross-period data incomplete (the two 5★ for Evernight and Time Waits for No One sit right on the window edge, for example).')"></p>
        <figure class="hp-fig">
          <img src="assets/help/06-roles.png" loading="lazy" :alt="L('五星角色与专属光锥', '5★ characters and their signature light cones')">
          <figcaption v-html="L('<b>图 7</b>　每格左边是角色、右边是他的专属光锥。<b>N 命</b> = 星魂等级，<b>叠 N</b> = 叠影等级，虚线圆圈 = 该专属光锥还没抽到。', '<b>Figure 7</b> In each cell the character sits on the left and their signature light cone on the right. <b>E N</b> = Eidolon rank, <b>S N</b> = superimposition rank, and a dashed circle means that signature light cone has not been pulled yet.')"></figcaption>
        </figure>
        <figure class="hp-fig">
          <img src="assets/help/07-cones.png" loading="lazy" :alt="L('五星光锥全览', 'All 5★ light cones')">
          <figcaption v-html="L('<b>图 8</b>　五星光锥全览，按命途分组。紫字 <b>专属·角色名</b> ＝ 限定池产出的专属光锥，灰字 <b>常驻·角色名</b> ＝ 常驻保底池那 7 张之一。', '<b>Figure 8</b> All 5★ light cones, grouped by Path. Purple <b>Signature · character</b> means a signature light cone from a limited banner; grey <b>Standard · character</b> means one of the seven in the standard pool.')"></figcaption>
        </figure>
        <div class="hp-kv">
          <b>{{ L('口径', 'Definitions') }}</b>
          <ul>
            <li v-html="L('<b>星魂 = 三源合并后抽到该角色的总金数 − 1</b>（上限 6）；<b>叠影 = 抽到该光锥的总张数</b>（上限 5）。', '<b>Eidolons = total 5★ copies of that character across the three sources − 1</b> (capped at 6); <b>superimposition = the total number of copies of that light cone</b> (capped at 5).')"></li>
            <li v-html="L('<b>跨界金不重复计</b>：保底跨接口窗口边界的那两条金（长夜月 / 时节不居），窗口内那条是残缺值，整条由截图段代表，只算一次。⚠️ 必须按它自带的 <code>gacha_id</code> 精确排除，<b>不能按角色名整体排除</b> —— 那会误伤复刻池。', '<b>A 5★ straddling the boundary is counted once</b>: for the two 5★ whose pity crosses the API window edge (Evernight / Time Waits for No One), the in-window row is a partial value and the whole thing is represented by the screenshot row, so it counts once. ⚠️ It must be excluded precisely by its own <code>gacha_id</code>, <b>never by name</b> — that would wrongly drop rerun banners too.')"></li>
            <li v-html="L('<b>前两源都可能缺</b>：接口缺窗口外的、截图缺窗口内的且只有五星那几行。所以纯靠抽卡记录算出的星魂 / 叠影是<b>下限</b>，不是绝对准确值 —— 这正是第三源（外部统计）要补的那块，见 6.1。', '<b>Either of the first two sources can be missing data</b>: the API lacks what is outside the window, and the screenshots lack what is inside it, covering only the 5★ rows. So Eidolons / superimposition computed purely from warp records are a <b>lower bound</b>, not an exact figure — precisely what the third source (external stats) fills in, see 6.1.')"></li>
            <li v-html="L('<b>五星光锥归属有三类</b>：<code>专属·角色名</code>（该角色的专属光锥）· <code>常驻·角色名</code>（常驻池那 7 张之一）· <code>限定</code>。<b>角色池与光锥池是两套不同的常驻名单，绝不共用</b>（歪到常驻五星光锥只会在那 7 张里出）。', '<b>A 5★ light cone falls into one of three classes</b>: <code>Signature · character</code> (that character’s own light cone) · <code>Standard · character</code> (one of the seven in the standard pool) · <code>Limited</code>. <b>The character pool and the light cone pool draw on two different standard lists and never share</b> (a lost 5★ light cone can only be one of those seven).')"></li>
            <li v-html="L('<b>数据来源标签</b>：彩色<b>实底</b> = 接口窗口解析所得；<b>虚线框</b> = 工坊截图补录（接口保留期之外）；紫色 <b>联动</b> = 联动池出货，单列一支、不按 UP/歪 读；标了<b>外部</b>的 = 命数取自外部统计补录（第三源）。', '<b>Source tags</b>: a filled colour = parsed from the API window; a <b>dashed border</b> = workshop screenshot backfill (beyond the API retention window); purple <b>Collab</b> = a collab banner 5★, listed on its own and not read as UP/lost; anything tagged <b>External</b> = the rank came from external stats (the third source).')"></li>
          </ul>
        </div>

        <h3 class="hp-h3">{{ L('6.1 第三源：外部统计补录 —— 把「真实持有状态」直接搬进来', '6.1 The third source: external stats — moving your real holdings straight in') }}</h3>
        <p class="hp-p" v-html="L('前两源都只能从<b>抽卡记录</b>倒推命数，天生缺窗口外那段，所以算出来是<b>下限</b>。但你的账号真实持有状态其实随处可见：<b>游戏内的角色 / 光锥列表</b>、<b>星穹工坊的角色统计页</b>、<b>米游社 / HoyoLab 的抽卡统计</b>。这些渠道的好处是它们<b>本来就存了完整历史</b>（第三方是长期累积在云端的），坏处是<b>只有数、没有抽数</b>。平台的做法是：把这一路单独收成<b>第三源</b>，<b>只喂「星魂 / 叠影 / 持有清单」，绝不碰任何抽数与比率口径</b>。', 'Both earlier sources can only infer ranks from <b>warp records</b>, and both are structurally blind to everything before the window, so what they produce is a <b>lower bound</b>. Your account’s real holdings, however, are easy to come by: the <b>in-game character / light cone lists</b>, the <b>Star Rail Station character stats page</b>, <b>HoYoLAB’s warp stats</b>. The upside of those channels is that they <b>already hold the complete history</b> (a third-party tool has been accumulating it in the cloud); the downside is that they have <b>counts but no warp counts</b>. So the platform collects this route as a separate <b>third source</b> and <b>feeds in only “Eidolons / superimposition / what you own”, never any warp count or rate</b>.')"></p>
        <p class="hp-p" v-html="L('入口在<b>「抓取与数据管理 → ⑤ 外部统计补录」</b>，就在「修改记录」下面。流程是 <b>上传截图 → 本机图标匹配预填 → 人工确认 → 保存到角色管理</b>：', 'The entry point is <b>“Fetch &amp; Data → ⑤ External stats”</b>, right below the edit history. The flow is <b>upload a screenshot → local icon matching pre-fills the table → you confirm → save to the Characters page</b>:')"></p>
        <table class="tb">
          <thead><tr><th>{{ L('步骤', 'Step') }}</th><th>{{ L('做什么', 'What you do') }}</th><th>{{ L('为什么这么做', 'Why it works this way') }}</th></tr></thead>
          <tbody>
            <tr><td style="white-space:nowrap"><b>{{ L('① 上传', '① Upload') }}</b></td>
              <td v-html="L('把截图拖进上传区（游戏内角色列表 / 工坊统计页 / 米游社统计页都行）', 'Drop a screenshot into the upload area (the in-game character list, a workshop stats page or HoYoLAB all work)')"></td>
              <td v-html="L('截图会留档到 <code>data/uploads/</code>，事后能回溯「这条命数是哪张图看来的」', 'The screenshot is archived under <code>data/uploads/</code>, so later you can trace which image a given rank came from')"></td></tr>
            <tr><td style="white-space:nowrap"><b>{{ L('② 识别', '② Recognise') }}</b></td>
              <td v-html="L('在<b>你自己的浏览器里</b>跑一遍图标检测 + 匹配，把确认表预填好', 'Icon detection and matching run <b>in your own browser</b> and pre-fill the confirmation table')"></td>
              <td v-html="L('平台<b>除「卡池日历」一处外全部离线</b>，不能调云端大模型；而本机 <code>assets/</code> 里就有整套头像 / 光锥图标，截图里的图标就是<b>同一套原图</b>渲染出来的 → 拿本地图标做模板匹配最准，且零联网', 'The platform is <b>fully offline apart from one item, the banner calendar</b>, so it cannot call a cloud model; but the local <code>assets/</code> already holds the whole avatar / light cone icon set, and the icons in a screenshot are rendered from <b>the very same artwork</b> → matching against local icons is the most accurate approach and needs no network')"></td></tr>
            <tr><td style="white-space:nowrap"><b>{{ L('③ 确认', '③ Confirm') }}</b></td>
              <td v-html="L('逐行看「图 / 类型 / 名字 / 星魂·叠影 / 分数」，错的手动改，缺的用「＋ 手动加一行」补', 'Go through each row’s image / type / name / Eidolon · superimposition / score; fix mistakes by hand and add missing rows with “+ Add a row manually”')"></td>
              <td v-html="L('<b>识别只是把表预填好，不替你做决定</b>：截图分辨率、UI 皮肤、缩放都会影响命中率。「分数」是匹配的相似度，越低越可疑；<b>宁可标「未识别」也不要猜错</b>；名字框有本地全量候选可下拉补全', '<b>Recognition only pre-fills the table; it does not decide for you</b>: screenshot resolution, UI skin and scaling all affect the hit rate. “Score” is the match similarity — the lower it is, the more suspicious; <b>better to mark something “not recognised” than to guess wrong</b>; the name field offers the full local candidate list as a dropdown')"></td></tr>
            <tr><td style="white-space:nowrap"><b>{{ L('④ 保存', '④ Save') }}</b></td>
              <td v-html="L('点「保存到角色管理」→ 立刻写进角色管理页', 'Click “Save to Characters” → it is written to the Characters page immediately')"></td>
              <td v-html="L('没在本地索引里找到的名字会被<b>拒绝写入并单独列出来</b>（<code>bad</code> 列表），不会污染数据', 'Names not found in the local index are <b>rejected and listed separately</b> (the <code>bad</code> list), so they cannot pollute the data')"></td></tr>
          </tbody>
        </table>
        <figure class="hp-fig">
          <img src="assets/help/10-external.png" loading="lazy" :alt="L('外部统计补录卡片', 'The external stats card')">
          <figcaption v-html="L('<b>图 9</b>　「抓取与数据管理 → ⑤ 外部统计补录」。上面是上传区与识别选项（默认「只匹配五星」），中间是截图预览（绿框 = 检出的图标位置），下面是识别后待确认的表：缩略图 + 类型 + 名字 + 星魂/叠影 + 分数。<b>这张演示图是合成的</b>（脚本在浏览器里画了一张「角色列表」风格的图再喂进去），分数只作示意。', '<b>Figure 9</b> “Fetch &amp; Data → ⑤ External stats”. At the top are the upload area and the recognition options (default: match 5★ only), in the middle the screenshot preview (green boxes = detected icon positions), and below the table awaiting confirmation: thumbnail + type + name + Eidolon / superimposition + score. <b>This demo image is synthetic</b> (a script draws a character-list-style image in the browser and feeds it back in), and the scores are illustrative only.')"></figcaption>
        </figure>
        <div class="hp-kv">
          <b>{{ L('四条必须说清楚的规则', 'Four rules worth stating plainly') }}</b>
          <ul>
            <li v-html="L('<b>语义 = 真值快照，覆盖旧值。</b>外部渠道说的是你<b>当前真实持有</b>的命数，比「从抽卡记录反推」更可信 —— 所以两者不一致时<b>以外部为准</b>，并且在行内<b>显式标出冲突</b>（引擎会同时保留一份「抽卡推算值」，方便你回头核对）。', '<b>Semantics: a ground-truth snapshot that overwrites older values.</b> An external channel states the ranks you <b>actually hold right now</b>, which is more trustworthy than inferring them from warp records — so when the two disagree <b>the external value wins</b>, and the conflict is <b>flagged explicitly in the row</b> (the engine also keeps a copy of the warp-history estimate so you can check back later).')"></li>
            <li v-html="L('<b>单位按类型分，别填错：</b><b>角色</b>填的是<b>星魂等级 0~6</b>（0 = 就抽到过一个，没有额外星魂）；<b>光锥</b>填的是<b>叠影等级 1~5</b>（1 = 只有 1 张）。超出范围会被夹到边界。', '<b>The unit depends on the type — do not mix them up:</b> <b>characters</b> take an <b>Eidolon rank of 0–6</b> (0 = pulled exactly once, no extra Eidolons); <b>light cones</b> take a <b>superimposition rank of 1–5</b> (1 = a single copy). Out-of-range values are clamped to the boundary.')"></li>
            <li v-html="L('<b>它不参与任何抽数口径。</b>总抽数、出金率、每 UP 抽数、小保底不歪<b>一个都不受它影响</b> —— 因为它只有命数没有抽数，掺进去就没法自证了。这条在接口层就切开了，页面上也写明了。', '<b>It feeds into no warp-count figure.</b> The total warps, 5★ rate, warps per UP and the 50/50 win rate are <b>none of them affected by it</b> — it has ranks but no warp counts, so mixing it in would make the figures unverifiable. This is separated at the API layer and stated on the page as well.')"></li>
            <li v-html="L('<b>重传即整体覆盖。</b>同一对「类型 + 名字」只保留一条；重新保存会<b>整体替换</b>上一份外部统计，不会两份叠着算。想清空就用卡片上的「清空全部外部统计」。', '<b>Re-uploading replaces the whole thing.</b> Only one row survives per “type + name” pair, and saving again <b>replaces</b> the previous external stats outright rather than stacking two sets. To wipe it, use “Clear all external stats” on the card.')"></li>
          </ul>
        </div>
        <div class="hp-warn" v-html="L('<b>识别不到是正常的，别把它当成「功能坏了」。</b>图标匹配要求截图里的图标和本机 <code>assets/</code> 是同一套原图；如果截图被裁过、加了水印、套了活动主题皮肤，或者那个角色本机的图标还没下载（<b>没抽到的角色不会有本地图标</b>），分数就会很低甚至检不出来。这时<b>手动加行</b>即可 —— 第三源的价值在于「有一份可信的持有状态」，而不在于「全自动认图」。', '<b>Failing to recognise something is normal — do not read it as a broken feature.</b> Icon matching requires the icons in the screenshot to be the same artwork as the local <code>assets/</code>; if the screenshot was cropped, watermarked or skinned with an event theme, or if that character’s icon has not been downloaded locally (<b>a character you have never pulled has no local icon</b>), the score will be low or nothing will be detected at all. In that case just <b>add the row by hand</b> — the value of the third source is <b>having a trustworthy ownership state</b>, not fully automatic image recognition.')"></div>
      </section>

      <!-- ⑦ ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-7">{{ L('7 · 这几个数字怎么算', '7 · How these numbers are computed') }} <small>{{ L('总抽数 · 出金率 · 每 UP · 小保底不歪', 'total warps · 5★ rate · warps per UP · 50/50 win rate') }}</small></h2>
        <p class="hp-p" v-html="L('这一章把「数据总貌」每张卡片的口径逐条讲清楚。<b>先记住一条分界线</b>：<b>总量类</b>（总抽数 / 五星数）用<b>人工补填</b> —— 因为接口拿不到完整历史；<b>比率类</b>（出金率 / 每 UP / 小保底不歪）<b>全部基于本地导入的跃迁记录实时计算</b>，每导入一次就自动重算。两者的分母本来就不一样，<b>不是数据矛盾</b>。', 'This chapter spells out the definition behind each card in “Data overview”. <b>One dividing line to remember first</b>: the <b>totals</b> (total warps / 5★ count) come from <b>manual backfill</b>, because the API cannot reach the full history; the <b>rates</b> (5★ rate / warps per UP / 50/50 win rate) are <b>all computed live from the locally imported warp records</b> and are recomputed on every import. The two have different denominators by construction — <b>that is not a data conflict</b>.')"></p>

        <h3 class="hp-h3">{{ L('7.1 总抽数 = 补填值 ＋ 之后新导入的记录', '7.1 Total warps = the backfilled value + records imported afterwards') }}</h3>
        <div class="hp-eq" v-html="gTotEq()"></div>
        <p class="hp-p" v-html="L('「数据补填」里填的两个数就是<b>总量基准</b>，再叠加<b>快照时间之后新导入的记录</b>。这样你只要偶尔去看一眼总量、填一次，之后新抽的卡会自动长上去。<br>⚠️ 快照时间是<b>精确到秒的完整时刻</b>，而且<b>打开页面时会实时跟随当前时间</b>（每秒走）—— 你不动它就等于「记下点保存的那一刻」；手动改过就停止跟随，旁边有「↻ 跟随当前时间」可以恢复。<br>为什么一定要秒级：如果只按「日」切分，当天 00:00 之后抽的记录会全部落进增量，而它们通常已经包含在你刚填的那个数里，<b>会重复计数</b>。（手动只填到「日」也允许，引擎会按<b>该日结束 23:59:59</b> 处理。）', 'The two numbers you enter under Backfill totals are the <b>baseline</b>, onto which <b>records imported after the snapshot time</b> are added. So you only need to check the totals occasionally and enter them once; new warps then accumulate on their own.<br>⚠️ The snapshot time is a <b>full timestamp down to the second</b>, and it <b>follows the current time live while the page is open</b> (ticking every second) — leave it alone and it means “the moment you pressed save”; edit it by hand and it stops following, with “↻ Follows the current time” alongside to resume.<br>Why second precision matters: with day-only granularity, every record pulled after 00:00 that day would land in the delta, yet those are usually already inside the number you just entered, so they <b>would be counted twice</b>. (Entering only a day is also allowed; the engine then treats the boundary as <b>that day’s end, 23:59:59</b>.)')"></p>
        <figure class="hp-fig">
          <img src="assets/help/09-fill.png" loading="lazy" :alt="L('数据补填卡片与修改记录', 'The backfill card and edit history')">
          <figcaption v-html="L('<b>图 10</b>　「抓取与数据管理 → ④ 数据补填」。填总抽数 / 五星数与快照时间，点「保存并更新」即可；「近期总抽数起点」是<b>只读的</b>（引擎自动取本地仓最早记录，显示到秒）。下方「修改记录」把每次输入的字段原样留档。', '<b>Figure 10</b> “Fetch &amp; Data → ④ Backfill totals”. Enter the total warps / 5★ count and the snapshot time, then click “Save &amp; update”; “start of the recent-warps window” is <b>read-only</b> (the engine takes the earliest record in the local store and shows it to the second). The edit history below files the fields of every entry verbatim.')"></figcaption>
        </figure>

        <h3 class="hp-h3">{{ L('7.2 出金率', '7.2 5★ rate') }}</h3>
        <div class="hp-eq" v-html="gRateEq()"></div>
        <p class="hp-p" v-html="gRateCompare()"></p>

        <h3 class="hp-h3">{{ L('7.3 每 UP 角色 / 每 UP 光锥需多少抽', '7.3 Warps per UP character / per UP light cone') }}</h3>
        <div class="hp-eq" v-html="gPerUpEq()"></div>
        <table class="tb">
          <thead><tr><th>{{ L('口径', 'Basis') }}</th><th class="hn">{{ L('每 UP 角色', 'Per UP character') }}</th><th class="hn">{{ L('每 UP 光锥', 'Per UP light cone') }}</th><th>{{ L('说明', 'Notes') }}</th></tr></thead>
          <tbody>
            <tr><td>{{ L('本平台（导入记录）', 'This platform (imported records)') }}</td><td class="num">{{ d.perUpCh }}</td><td class="num">{{ d.perUpLc }}</td>
              <td v-html="gPerUpNote()"></td></tr>
            <tr><td>{{ L('同一份数据、工坊式子', 'Same data, workshop formula') }}</td><td class="num">{{ d.perUpChWsSame }}</td><td class="num">{{ d.perUpLcWsSame }}</td>
              <td v-html="L('<code>池抽数 ÷ UP 数</code> —— 与上一行<b>恒差 1.0 抽/UP</b>（差的正是 UP 数本身）', '<code>banner warps ÷ UPs</code> — <b>always 1.0 warp per UP higher</b> than the row above (the gap is exactly the UP count itself)')"></td></tr>
            <tr><td>{{ L('工坊页面显示', 'As shown by the workshop') }}</td><td class="num">82.6</td><td class="num">52.9</td>
              <td v-html="L('它的历史更完整（含接口保留期之外那些抽），且用它自己的式子', 'Its history is more complete (it includes the warps from before the API retention window) and it uses its own formula')"></td></tr>
          </tbody>
        </table>
        <p class="hp-p" v-html="L('<b>只用本地导入的记录算，不掺截图补录</b> —— 补录那份是写死的常量，掺进来就不满足「每次导入都要实时更新」这条要求。所以别拿工坊那两个数字直接对：<b>口径差（1.0 抽/UP）＋ 数据范围差（补录那部分历史）</b>叠加起来才是差值。', '<b>Computed from locally imported records only, with no screenshot backfill mixed in</b> — the backfill is a hard-coded constant, and including it would break the requirement that every import updates the figure live. So do not compare the workshop’s two numbers directly: <b>the definition gap (1.0 warp per UP) plus the coverage gap (the historical stretch the backfill covers)</b> together make up the difference.')"></p>

        <h3 class="hp-h3">{{ L('7.4 小保底不歪', '7.4 The 50/50 win rate') }}</h3>
        <div class="hp-eq" v-html="gSmallEq()"></div>
        <p class="hp-p" v-html="gSmallDef()"></p>
        <div class="hp-kv">
          <b>{{ L('三个要说清楚的点', 'Three points worth spelling out') }}</b>
          <ul>
            <li v-html="L('<b>为什么分角色 / 光锥两个数</b>：两个池的 UP 名单与保底都独立，合起来算会互相稀释。', '<b>Why characters and light cones are counted separately</b>: the two pools have independent featured lists and pity counters, so lumping them together dilutes both.')"></li>
            <li v-html="L('<b>唯一会失真的情形</b>：本地记录里该池「最后一颗金是歪」（这次歪还没兑现成 UP）→ 会少算一次小保底。这时卡片小字会标出「<b>末次出金是歪、尚未兑现</b>」，一眼能看见。', '<b>The one case where it distorts</b>: if the last 5★ in that banner in the local records was a loss (a loss not yet redeemed by a UP) → one 50/50 win is undercounted. When that happens the card’s small print says “<b>last 5★ was a loss, not yet redeemed</b>”, so it is visible at a glance.')"></li>
            <li v-html="L('<b>同样只用导入记录算</b>，与工坊显示的是同一个算法（工坊那 54.3% 是它含更完整历史的版本，量级可比）。', '<b>Also computed from imported records only</b>, and using the same algorithm the workshop uses (its 54.3% is simply the version with a more complete history, so the magnitudes are comparable).')"></li>
          </ul>
        </div>

        <h3 class="hp-h3">{{ L('7.5 截图补录：怎么读出来的、怎么验的', '7.5 Screenshot backfill: how it was read and how it was checked') }}</h3>
        <p class="hp-p" v-html="gBackfillHow()"></p>
        <p class="hp-p" v-html="L('最硬的一条验证在常驻池：它是<b>唯一抽数与截图能逐条核对</b>的池（保底线性、没有「歪」的概念）——', 'The hardest check of all is on the standard pool: it is the <b>only pool whose warp counts can be reconciled against the screenshots row by row</b> (its pity is linear and there is no notion of “losing”):')"></p>
        <table class="tb">
          <thead><tr><th>{{ L('核对项', 'Check') }}</th><th class="hn">{{ L('数值', 'Value') }}</th><th>{{ L('说明', 'Notes') }}</th></tr></thead>
          <tbody>
            <tr><td>{{ L('窗口内出金', '5★ inside the window') }}</td><td class="num">{{ gq.n }}</td><td v-html="gGoldRowNote()"></td></tr>
            <tr><td v-html="gOldestCell()"></td><td class="num">{{ gq.full }}</td>
              <td v-html="gOldestGold()"></td></tr>
          </tbody>
        </table>
        <div class="hp-warn" v-html="L('<b>⚠️ 这份补录现在只服务「角色管理」页的星魂 / 叠影</b>（那两项本来就要跨期合并），<b>不再参与</b>出金率 / 每 UP / 小保底不歪 —— 因为它不会随导入变化。它和 6.1 讲的<b>外部统计补录</b>是两件事：这份是「从工坊截图里读出来的<b>逐条抽卡明细</b>（带抽数）」，那份是「从任意渠道截图里读出来的<b>当前持有状态</b>（只有命数）」。', '<b>⚠️ This backfill now serves only the Eidolons / superimposition on the Characters page</b> (those two have to merge across periods anyway) and <b>no longer feeds</b> the 5★ rate, warps per UP or the 50/50 win rate — because it does not change with your imports. It is a different thing from the <b>external stats</b> in 6.1: this one is <b>row-by-row warp detail read out of workshop screenshots</b> (with warp counts), while that one is <b>your current ownership state read out of a screenshot from any channel</b> (ranks only).')"></div>

        <h3 class="hp-h3">{{ L('7.6 三个仍然要当心的地方', '7.6 Three things that still need care') }}</h3>
        <ul class="hp-ul">
          <li v-html="gDedup()"></li>
          <li v-html="gPityInput()"></li>
          <li v-html="L('<b>别把「外部统计」当抽数用</b>：6.1 那条第三源<b>只有命数、没有抽数</b>，所以它绝不会进总抽数 / 出金率 / 每 UP / 小保底不歪的分母。看到角色管理页的星魂变了、而出金率一动不动，这是<b>设计如此</b>，不是数据没更新。', '<b>Do not use “external stats” as warp counts</b>: the third source in 6.1 has <b>ranks only, no warp counts</b>, so it never enters the denominator of the total warps / 5★ rate / warps per UP / 50/50 win rate. If the Eidolons on the Characters page change while the 5★ rate does not move, that is <b>by design</b>, not stale data.')"></li>
        </ul>
      </section>

      <!-- ⑧ ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-8">{{ L('8 · 吉凶是怎么算的', '8 · How the auspiciousness rating works') }} <small>{{ L('离线万年历，日家 + 时家黄黑道', 'an offline almanac: day and hour indicators') }}</small></h2>
        <p class="hp-p" v-html="L('每次出金都会按<b>出金那一刻</b>补一个吉凶。用的是内置的万年历引擎（<b>完全离线、不联网</b>），取的都是「万年历共有信息」：<b>日家</b>十二天神（黄道 / 黑道）、建除十二神、二十八宿、当日宜忌，以及<b>时家</b>十二天神。', 'Every 5★ gets an auspiciousness rating for <b>the instant it dropped</b>, computed by a built-in almanac engine (<b>entirely offline, no network</b>) from information every almanac shares: the <b>day</b> indicators — the twelve day deities (yellow and black paths), the twelve day officers, the twenty-eight mansions, the day’s do and don’t lists — plus the twelve <b>hour</b> deities.')"></p>
        <div class="hp-two">
          <div class="hp-card">
            <div class="hp-card-h">{{ L('评级规则（日为主、时为辅）', 'Rating rule (day leads, hour assists)') }}</div>
            <div class="hp-card-b" v-html="L('日黄道 ＋ 时黄道 = <span class=&quot;jxb j1&quot;>大吉</span>　·　日黄道 ＋ 时黑道 = <span class=&quot;jxb j2&quot;>吉</span><br>日黑道 ＋ 时黄道 = <span class=&quot;jxb p&quot;>平</span>　·　日黑道 ＋ 时黑道 = <span class=&quot;jxb x&quot;>凶</span>', 'Yellow day + yellow hour = <span class=&quot;jxb j1&quot;>Great Fortune</span>　·　yellow day + black hour = <span class=&quot;jxb j2&quot;>Auspicious</span><br>Black day + yellow hour = <span class=&quot;jxb p&quot;>Neutral</span>　·　black day + black hour = <span class=&quot;jxb x&quot;>Ominous</span>')"></div>
          </div>
          <div class="hp-card">
            <div class="hp-card-h">{{ L('为什么同一天吉凶会变', 'Why one date carries different ratings') }}</div>
            <div class="hp-card-b" v-html="L('同一天里<b>每个时辰的黄黑道都不一样</b>，所以同一个日子的吉凶会随时辰变化。鼠标悬停徽章可以看到该时刻的干支、建除、星宿与当日宜忌。', 'The <b>yellow/black designation differs from hour to hour</b> within a single day, so the rating for one date changes with the time. Hovering a badge shows that moment’s stems and branches, day officer, mansion, and the day’s do and don’t lists.')"></div>
          </div>
        </div>
        <div class="hp-note" v-html="L('这是个<b>趣味指标</b>：它只是把抽卡时间对齐到万年历上，<b>与出金概率没有任何因果关系</b>，别拿它做决策依据 :)', 'This is a <b>for-fun indicator</b>: it merely lines your warp times up against the almanac and has <b>no causal relationship whatsoever with 5★ probabilities</b>. Do not base decisions on it :)')"></div>
      </section>

      <!-- ⑨ ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-9">{{ L('9 · 日常维护手册', '9 · Routine maintenance') }} <small>{{ L('什么时候需要动什么', 'what to touch, and when') }}</small></h2>
        <table class="tb">
          <thead><tr><th>{{ L('你做了什么', 'What you did') }}</th><th>{{ L('平台要做什么', 'What the platform needs') }}</th><th>{{ L('怎么做', 'How') }}</th></tr></thead>
          <tbody>
            <tr><td>{{ L('又抽了卡（任意池）', 'Pulled more (any banner)') }}</td><td>{{ L('增量同步记录、自动补新角色/光锥图标', 'Sync the new records incrementally and fetch any new character / light cone icons') }}</td>
              <td v-html="L('<b>抓取与数据管理</b> → 贴一条新的抽卡链接 → 抓取。历史永远取并集、不会覆盖；<b>出金率 / 每 UP / 小保底不歪会自动重算</b>。', '<b>Fetch &amp; Data</b> → paste a fresh warp link → fetch. History is always a union and is never overwritten; <b>the 5★ rate / warps per UP / 50/50 win rate recompute automatically</b>.')"></td></tr>
            <tr><td>{{ L('重新看了一次总量数字', 'Looked the totals up again') }}</td><td>{{ L('更新「数据补填」的总抽数 / 五星数', 'Update the total warps / 5★ count under Backfill totals') }}</td>
              <td v-html="L('<b>抓取与数据管理 → ④ 数据补填</b>：填两个数 + 快照时间（默认 = 现在，秒级实时跟随）→「保存并更新」。其余口径全自动衍生，下方会追加一条修改记录。', '<b>Fetch &amp; Data → ④ Backfill totals</b>: enter the two numbers plus the snapshot time (default = now, ticking live to the second) → “Save &amp; update”. Everything else is derived automatically, and an entry is appended to the edit history.')"></td></tr>
            <tr><td>{{ L('重新截了工坊的卡池明细', 'Took fresh workshop screenshots of banner detail') }}</td><td>{{ L('更新「已垫 N 抽」与补录行', 'Update “N warps into pity” and the backfill rows') }}</td>
              <td v-html="L('改 <code>core/pools.js</code>；<b>改完必须用接口自算复核「已垫」</b>（见 7.6 的警告）。', 'Edit <code>core/pools.js</code>; <b>afterwards the pity value must be re-verified against the API</b> (see the warning in 7.6).')"></td></tr>
            <tr><td>{{ L('发现某个角色的星魂 / 叠影偏低', 'Noticed a character’s Eidolon / superimposition looks too low') }}</td><td>{{ L('用第三源把真实持有状态补进来', 'Bring the real holdings in through the third source') }}</td>
              <td v-html="L('<b>抓取与数据管理 → ⑤ 外部统计补录</b>：传一张游戏内角色列表 / 工坊统计页截图 → 核对确认表 → 保存。它会<b>覆盖</b>抽卡推算值，且<b>不影响任何抽数比率</b>（见 6.1）。', '<b>Fetch &amp; Data → ⑤ External stats</b>: upload a screenshot of the in-game character list or a workshop stats page → check the confirmation table → save. It <b>overwrites</b> the warp-history estimate and <b>affects no warp-based rate</b> (see 6.1).')"></td></tr>
            <tr><td>{{ L('发现某处数字对不上', 'Found a number that does not add up') }}</td><td>{{ L('先分清是「总量」还是「比率」', 'First work out whether it is a total or a rate') }}</td>
              <td v-html="L('总量看<b>④ 数据补填</b>里生效的基准；比率看本页第 7 章的口径，再对「数据管理 → ③ 各卡池时间边界」的记录数。', 'For a total, look at the baseline in effect under <b>④ Backfill totals</b>; for a rate, check the definitions in chapter 7, then compare against the record counts in “Data → ③ Per-banner time bounds”.')"></td></tr>
          </tbody>
        </table>
        <details class="fold hp-faq">
          <summary>{{ L('常见疑问', 'Common questions') }} <span class="fsm">{{ L('点开看 4 条', 'click to open all four') }}</span></summary>
          <div class="hp-kv">
            <ul>
              <li v-html="L('<b>为什么不能一条链接还原我的全部历史？</b>接口只保留约 1 年且是滑动窗口，早期的记录服务器已经删了、不可恢复。第三方的全量数字是它长期累积在云端的，本机拿不到。', '<b>Why can one link not rebuild my whole history?</b> The API keeps only about a year and does so as a sliding window; earlier records are already deleted server-side and cannot be recovered. A third-party tool’s full figure is something it accumulated in the cloud over time, and this machine cannot reach it.')"></li>
              <li v-html="L('<b>数据会上传吗？</b>不会。服务只跑在 <code>127.0.0.1</code>，记录存在本机 <code>data/records.json</code>，只有抓取那一瞬间会向官方接口发请求。', '<b>Is anything uploaded?</b> No. The service listens on <code>127.0.0.1</code> only and records live in the local <code>data/records.json</code>; the sole moment anything is sent out is the request to the official API during a fetch.')"></li>
              <li v-html="L('<b>怎么把历史补得更全？</b>两条路：从现在起每次抽完都抓一次（并集会越来越长）；或者导入第三方工具导出的 <b>UIGF / SRGF</b> 记录文件。', '<b>How do I make the history more complete?</b> Two routes: fetch after each session from now on (the union grows over time), or import a <b>UIGF / SRGF</b> record file exported by a third-party tool.')"></li>
              <li v-html="L('<b>星魂 / 叠影为什么可能比实际低？</b>因为从抽卡记录算只能拿到接口窗口内那段，窗口外的金看不到，算出来自然是<b>下限</b>。要补两条路：<b>持续同步</b> / 导入完整记录文件，或者直接用<b>第三源</b>（「数据管理 → ⑤ 外部统计补录」，见 6.1）—— 后者不依赖历史，直接把当前真实持有状态搬进来。', '<b>Why can the Eidolon / superimposition figures read lower than reality?</b> Because computing from warp records only reaches the part inside the API window — 5★ from before it are invisible, so the result is naturally a <b>lower bound</b>. There are two ways to fix that: <b>keep syncing</b> / import a complete record file, or simply use the <b>third source</b> (“Data → ⑤ External stats”, see 6.1) — the latter does not depend on history at all, it moves your current real holdings straight in.')"></li>
            </ul>
          </div>
        </details>
      </section>

      <div class="foot" v-html="L('本页只解释口径，不产生新数据 · 所有计算都在本机完成<br>截图拍摄于 2026-09-16，随数据更新可能与你屏幕上的数字略有出入', 'This page only explains definitions and produces no new data · every calculation runs on this machine<br>The screenshots were taken on 2026-09-16 and may differ slightly from the numbers on your screen as the data changes')"></div>
    </div>`,
  };
})();
