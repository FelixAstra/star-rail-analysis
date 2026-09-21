// ─────────────────────────────────────────────────────────────────────────────
// 「解释说明」页 —— 把原先散在「抽卡分析」页各板块的长段解释文字集中到这里
// 组织方式：先一个「一分钟看懂」，再按「数据来源 → 卡池 → 读数 → 对账 → 维护」的
// 认知顺序排 9 章，每章 = 一句话结论 + 正文 + 界面截图 + 关键点。顶部有目录可跳转。
// 说明：正文里的实时数字随数据变，截图是 2026-09-16 的界面快照（图注里都标了）。
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const W = window.W = window.W || {};

  // 目录：章节号 / 锚点 / 标题 / 一句话
  const TOC = [
    ['1', 'hp-1', '这套数字从哪来', '三种数据来源与各自的可信范围'],
    ['2', 'hp-2', '六个卡池与两条端点', '联动池为什么普通链接永远拿不到'],
    ['3', 'hp-3', '保留期是滑动窗口', '为什么必须持续同步、并集合并'],
    ['4', 'hp-4', 'gacha_id 才是「哪一池」', '时间区间不等于在架时长'],
    ['5', 'hp-5', '出金明细怎么读', '池内第几抽 · 真实保底 · 吉凶'],
    ['6', 'hp-6', '角色管理怎么读', '星魂 / 叠影 / 三源合并 / 光锥归属'],
    ['7', 'hp-7', '这几个数字怎么算', '总抽数 · 出金率 · 每 UP · 小保底不歪'],
    ['8', 'hp-8', '吉凶是怎么算的', '万年历日家 / 时家黄黑道'],
    ['9', 'hp-9', '日常维护手册', '抽了新卡、重新截了工坊页之后做什么'],
  ];

  const FIG = (n, name, cap) => ({ n, name, cap });

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
    },
    template: `
    <div class="wrap hp">
      <div class="pagehead">
        <div>
          <h1>解释说明</h1>
          <div class="sub">这一页是<b>说明书</b>：把「抽卡分析」「角色管理」里每一块数字的<b>来源、口径、坑</b>讲清楚。
            数字会随数据变，<b>截图是 2026-09-16 的界面快照</b>，只作示意。</div>
        </div>
        <div class="pg-actions">
          <button class="btn" @click="goto('analysis')">← 回 抽卡分析</button>
          <button class="btn" @click="goto('roles')">✦ 去 角色管理</button>
        </div>
      </div>

      <div class="hp-toc">
        <a class="hp-toc-i" v-for="t in TOC" :key="t[0]" :href="'#' + t[1]">
          <b class="hp-toc-n">{{ t[0] }}</b>
          <span><b>{{ t[2] }}</b><i>{{ t[3] }}</i></span>
        </a>
      </div>

      <div class="hp-tip">
        <b>一分钟看懂：</b>你看到的每一个数字，只会来自这四种来源之一 ——
        <b>① 总量补填</b>（「数据补填」里手填的总抽数 / 五星数，本机无法逐条还原，所以直接采信）·
        <b>② 官方抽卡接口</b>（逐条记录，但只保留约 1 年）·
        <b>③ 工坊截图补录</b>（把 ② 拿不到的那段从截图里读出来）·
        <b>④ 外部统计补录</b>（你从游戏内角色列表 / 工坊统计页等渠道截图，人工确认后的<b>当前真实持有状态</b>，只有命数、没有抽数）。
        前三种<b>按 <code>id</code> / <code>item_id</code> 剔重后合并</b>；而「出金率 / 每 UP / 小保底不歪」
        这类比率<b>只用 ② 实时计算</b>，所以每导入一次就会自动更新；<b>④ 不参与任何抽数口径</b>，只影响角色管理页的星魂 / 叠影。下面逐条讲。
      </div>

      <!-- ① ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-1">1 · 这套数字从哪来 <small>四种来源，各自的可信范围不同</small></h2>
        <p class="hp-p">
          抽卡数据有四条来路，<b>可信范围和粒度都不一样</b>。平台的原则是：<b>能用逐条记录算的，绝不采信总数；逐条记录拿不到的，才用工坊快照和截图补录兜底。</b>
        </p>
        <table class="tb">
          <thead><tr><th>来源</th><th>给什么</th><th>粒度</th><th>边界</th></tr></thead>
          <tbody>
            <tr><td>官方接口<br><span class="dim2">getGachaLog</span></td><td>逐条记录（含时间、物品、星级）</td>
              <td>一条不差</td><td>只保留约 180 天 ~ 1 年；<b>普通池本账号最早只到 {{ o.retentionEdge }}</b></td></tr>
            <tr><td>官方联动接口<br><span class="dim2">getLdGachaLog</span></td><td>联动池（21/22）逐条记录</td>
              <td>一条不差</td><td>保留期更长，本账号能回溯到 <b>{{ o.ldEdge }}</b></td></tr>
            <tr><td>总量补填<br><span class="dim2">数据管理 → ④</span></td><td><b>只有总量</b>（总抽数 / 五星数）</td>
              <td>两个汇总数</td><td>人工填；以后每次导入都会在它之上叠加新增</td></tr>
            <tr><td>工坊截图补录</td><td>窗口外那段的历史跃迁明细</td>
              <td>每行一位五星 + 抽数</td><td>人工读数，只能补「五星那一行」的信息；<b>只服务角色管理页</b></td></tr>
            <tr><td>外部统计补录<br><span class="dim2">数据管理 → ⑤</span></td><td><b>只有命数</b>（星魂 / 叠影等级）与持有清单</td>
              <td>每个角色 / 光锥一个数</td><td>上传截图 → 本机图标匹配预填 → 人工确认；<b>语义是真值快照，覆盖旧值</b>，见 6.1</td></tr>
          </tbody>
        </table>
        <p class="hp-p">
          于是有了两条不同口径的「总抽数」，别混着看：
        </p>
        <div class="hp-two">
          <div class="hp-card">
            <div class="hp-card-h">数据总貌 · 总抽数 <b>{{ o.tot.p }}</b></div>
            <div class="hp-card-b">＝ <b>数据补填</b>的总量 <b>{{ o.wsBase.pulls }}</b>（快照时刻 {{ o.wsAt }}）<template v-if="o.inc.p">＋ 那之后新导入的 <b>{{ o.inc.p }}</b> 抽</template><template v-else>（目前没有晚于它的新记录）</template>。
              <b>这是「账号全部历史」的口径</b> —— 本机自己做不完这件事，因为接口早就把早期记录删了，
              所以总量改成<b>人工补填</b>（「数据管理 → ④ 数据补填」）。</div>
          </div>
          <div class="hp-card">
            <div class="hp-card-h">数据总貌 · 近期总抽数 <b>{{ r.p }}</b></div>
            <div class="hp-card-b">＝ <b>本地仓全部导入记录</b>（起点 <b>{{ r.from }}</b>，引擎自动取最早一条、<b>不可修改</b>）：
              角色活动 {{ r.byPool.ch }} ＋ 光锥活动 {{ r.byPool.lc }} ＋ 群星 {{ r.byPool.std }} ＋ 联动 {{ r.byPool.ld }}。
              <b>这是「可以逐条验证」的口径</b> —— 出金率、每 UP、小保底不歪都基于它，所以每导入一次就自动更新。</div>
          </div>
        </div>
        <figure class="hp-fig">
          <img src="assets/help/01-summary.png" loading="lazy" alt="抽卡总结示意图">
          <figcaption><b>图 1</b>　第三方统计工具或游戏内总结页上一般能看到<b>总抽数</b>与<b>五星数</b>这两个汇总数（图中为演示数据的示意图）。
            平台的「数据补填」只读这两个数当基准；
            其余几项（平均出金、每 UP、小保底不歪）由平台基于<b>本地导入的记录</b>自行计算，口径见第 7 章。</figcaption>
        </figure>
        <figure class="hp-fig">
          <img src="assets/help/02-overview.png" loading="lazy" alt="数据总貌卡片">
          <figcaption><b>图 2</b>　平台的「数据总貌」。每张卡片下面那行小字就是它的口径（点「解释说明」随时回来查）。</figcaption>
        </figure>
        <div class="hp-kv">
          <b>要点</b>
          <ul>
            <li><b>出金率</b>给了三个数：<b>{{ r.rate }}%</b>（本地记录含联动）· <b>{{ r.noLd.rate }}%</b>（剔除联动，与常规池可比）· <b>{{ r.fullRate }}%</b>（工坊全量口径）。
              三者同量级即说明解析无误；<b>联动池出金规则不同</b>（不存在「歪到常驻」），所以不要只引用其中一个。</li>
            <li><b>两种口径不要混用</b>：总量（总抽数 / 五星数）来自<b>补填</b>，比率（出金率 / 每 UP / 小保底不歪）来自<b>本地导入记录</b> ——
              两者的分母本来就不一样，不是数据矛盾。每张卡片下方那行小字都写了它自己的口径，详见第 7 章。</li>
            <li><b>「近期总抽数」的起点是自动的</b>：永远等于本地仓最早的一条记录（本账号 <b>{{ r.from }}</b>，联动池首抽）。
              随着你持续导入，这个起点只会往左固定下来，不会因为接口滑动而漂移。</li>
          </ul>
        </div>
      </section>

      <!-- ② ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-2">2 · 六个卡池与两条端点 <small>保底各自独立，统计不能合并成一条链</small></h2>
        <p class="hp-p">
          一个账号的抽卡记录由 <b>6 个池</b>组成，<b>保底各自独立、互不共享</b>（角色池 90 抽、光锥池 80 抽、新手池 50 抽封顶）：
        </p>
        <table class="tb">
          <thead><tr><th>卡池</th><th class="hn">gacha_type</th><th>记录从哪来</th></tr></thead>
          <tbody>
            <tr><td>角色活动跃迁</td><td class="num">11</td><td>普通链接（仅窗口内）</td></tr>
            <tr><td>光锥活动跃迁</td><td class="num">12</td><td>普通链接（仅窗口内）</td></tr>
            <tr><td>群星跃迁（常驻）</td><td class="num">1</td><td>普通链接，但<b>只有窗口内那部分</b>（本账号窗口内 233 抽）</td></tr>
            <tr><td>始发跃迁（新手）</td><td class="num">2</td><td>50 抽封顶、老账号早已抽完 → 接口返回空，只能靠截图</td></tr>
            <tr><td>角色联动跃迁</td><td class="num">21</td><td><b>另一条端点 <code>getLdGachaLog</code></b></td></tr>
            <tr><td>光锥联动跃迁</td><td class="num">22</td><td>同上</td></tr>
          </tbody>
        </table>
        <div class="hp-warn">
          <b>⚠️ 联动池用普通链接抓，永远返回 0 条 —— 而且不报错。</b>
          它的 <code>gacha_type</code> 是 21/22，但 <code>getGachaLog</code> 这个端点根本不返回它们，必须换成
          <code>…/api/getLdGachaLog</code>。表现是<b>静默的空列表</b>，和「你没抽过联动池」长得一模一样。
          平台在抓取时对六个池分别走对应端点，所以你能看到联动角色池那 <b>{{ recsOf('21') }}</b> 条（含远坂凛）与联动光锥池那 <b>{{ recsOf('22') }}</b> 条记录。
        </div>
        <figure class="hp-fig">
          <img src="assets/help/03-pool-bounds.png" loading="lazy" alt="各卡池时间边界表">
          <figcaption><b>图 3</b>　「各卡池时间边界」。标「另一端点」的两行走联动端点；它们的<b>跨度特别长是因为把历史上多期按 gacha_type 合并了</b>，不代表连开了一年。</figcaption>
        </figure>
        <div class="hp-kv">
          <b>要点</b>
          <ul>
            <li>「链接里缺某池」有<b>三种完全不同的原因</b>，别混：① <b>超出保留期</b>（静默空返回）② <b>该池走另一条端点</b>（联动）③ <b>真的没抽过</b>。</li>
            <li>超期<b>不报错</b>（<code>retcode=0</code>、<code>message=OK</code>，只是 <code>list</code> 为空），所以<b>不能拿「返回条数 &lt; 请求条数」判定到底了</b>。</li>
          </ul>
        </div>
        <p class="hp-p">
          「各卡池时间边界」那张表（现在在<b>「抓取与数据管理」页</b>）各列的含义：
        </p>
        <table class="tb">
          <thead><tr><th>列</th><th>含义</th></tr></thead>
          <tbody>
            <tr><td style="white-space:nowrap"><b>记录数</b></td>
              <td>本地仓里该池的条数 —— <b>窗口内能拿到的那部分</b>。角色活动池现在是 <b>{{ recsOf('11') }}</b> 条</td></tr>
            <tr><td style="white-space:nowrap"><b>最早 / 最晚</b></td>
              <td>该池能回溯到的第一条与最新一条<b>抽卡时间</b>，也就是滑动窗口的左右端（本账号普通池最早只到 <b>{{ o.retentionEdge }}</b>）</td></tr>
            <tr><td style="white-space:nowrap"><b>跨度</b></td>
              <td>＝ 最晚 − 最早，<b>不是卡池在架时长</b>。联动池那两行跨一年，是因为它把历史上多期按 <code>gacha_type</code> 合并了，不代表连开一年</td></tr>
            <tr><td style="white-space:nowrap"><b>五星</b></td>
              <td>该池窗口内出过几颗金（群星跃迁现在是 <b>{{ gq.n }}</b> 颗）</td></tr>
            <tr><td style="white-space:nowrap"><b>已垫抽数</b></td>
              <td><b>距该池最近一次出金之后又抽了多少抽</b>；斜杠后面是该池的<b>保底上限</b>（角色 <code>90</code> / 光锥 <code>80</code> / 新手 <code>50</code> / 常驻 <code>90</code>）。
                它<b>只数本池</b>，与出金明细里的「真实保底」不是一回事 —— 后者<b>跨同类型卡池累计</b></td></tr>
          </tbody>
        </table>
      </section>

      <!-- ③ ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-3">3 · 保留期是「滑动窗口」 <small>进新的、挤旧的，所以每次抓取都必须留档</small></h2>
        <p class="hp-p">
          官方接口不是「保留最近 1 年就固定不动」，而是<b>滑动窗口：来了新记录，最老的就被挤掉</b>。
          实测同一个账号隔一天抓两次：旧的一份 3188 条、跨度 <code>2025-09-15 → 09-14</code>；
          新的一份 3189 条、跨度 <code>2025-09-22 → 09-16</code> —— <b>新的条数更多，但起点右移了 7 天</b>，
          只读最新那份就会白丢窗口左端那条记录（实测丢过一条 <code>09-15</code> 的青雀）。
        </p>
        <div class="hp-two">
          <div class="hp-card">
            <div class="hp-card-h">所以平台这么做</div>
            <div class="hp-card-b">每次抓回来的结果都<b>按 <code>id</code> 去重合并</b>进 <code>data/records.json</code>，原始文件另外留一份到
              <code>data/snapshots/</code>。<b>取并集、永不覆盖</b> —— 每同步一次，历史左端就永久固定在最早那次抓到的位置。</div>
          </div>
          <div class="hp-card">
            <div class="hp-card-h">推论：总抽数只能「持续累积」</div>
            <div class="hp-card-b">一条链接<b>不可能</b>还原第三方工具的全量历史（它云端存了 5588 抽，接口只给你窗口里那 3273 条）。
              要做完整历史只有两条路：<b>从现在起持续同步</b>，或者<b>导入第三方导出的记录文件</b>（UIGF / SRGF 格式）。</div>
          </div>
        </div>
        <h3 class="hp-h3">3.1 导入的完整生命周期：第一次建仓，之后只累加</h3>
        <div class="hp-eq">
          第一次导入 → <b>建立本地仓</b>　·　之后再导入 → <b>校验 + 累计</b>（旧记录原样不动，只追加新出现的）
        </div>
        <ol class="hp-ul" style="margin:0 0 12px">
          <li><b>第一次导入</b>：把当时接口窗口内的全部记录收进本地仓，这就是仓的起点 ——
            本账号首次导入是 <b>{{ ts(firstImp ? firstImp.at : '') }}</b>，一次入库 <b>{{ firstImp ? firstImp.incoming : 0 }}</b> 条。</li>
          <li><b>之后每次导入</b>：把新拿到的一批与本地仓<b>按 <code>id</code> 逐条比对</b> ——
            已经存在的记录<b>原样不动</b>（重复出现就跳过），只把<b>新出现的</b>追加进去；
            同时在 <code>data/snapshots/</code> 留一份原始快照，事后能查「这条是哪次抓来的」。</li>
          <li><b>结果</b>：本地仓<b>只会变长</b>，起点只往左固定、不会因为接口滑动而漂移。
            目前已经导入 <b>{{ impN }}</b> 次，本地仓共 <b>{{ d.list.length }}</b> 条
            [{{ a.dataRange.from.slice(0,10) }} → {{ a.dataRange.to.slice(0,10) }}]。</li>
        </ol>
        <figure class="hp-fig">
          <img src="assets/help/08-manage.png" loading="lazy" alt="抓取与数据管理页">
          <figcaption><b>图 4</b>　「抓取与数据管理」：贴一条抽卡链接就能增量同步，下方能看到每一次导入的来源与新增条数。</figcaption>
        </figure>
        <div class="hp-warn">
          <b>⚠️ 抓完一整轮（6 池 ≈ 200+ 次请求）后，接口侧会临时限流</b>：整条域名连不上，但其它米哈游域名正常 ——
          <b>这不是断网、也不是链接（authkey）失效</b>，很容易误判成「链接过期了」。等几分钟再试即可，重试用 45 秒级的长间隔。
        </div>
      </section>

      <!-- ④ ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-4">4 · <code>gacha_id</code> 才是「哪一池」 <small>时间区间 ≠ 在架时长</small></h2>
        <p class="hp-p">
          <code>gacha_id</code> 是<b>卡池的身份编号</b>，不是时间区间。同一半期会有<b>两个并行卡池</b>同时上架，
          你在两池之间来回抽时，同一个 <code>gacha_id</code> 的记录就会被分成<b>不连续的多段</b>，不同 <code>gacha_id</code> 的区间还会互相重叠。
          所以平台<b>按 <code>gacha_id</code> 归并</b>：一个卡池只出现一行，抽数与五星构成不会被拆散
          （按「id 一变就切段」会把角色池虚报成 45 个池，实际只有 30 个）。
        </p>
        <p class="hp-p">
          表里的「<b>时间区间</b>」是<b>该池首末抽卡时间</b>（从你的记录时间戳算出来的），<b>不是卡池在架时长</b>。
        </p>
        <figure class="hp-fig">
          <img src="assets/help/04-banners.png" loading="lazy" alt="当期卡池识别">
          <figcaption><b>图 5</b>　「当期卡池识别」。按 gacha_id 一行一池；「来源」三色 = <span class="tg ok">出金</span> 抽到过当期 UP / <span class="tg bad">歪常驻</span> 出金但全歪 / <span class="tg dim">未出金</span>；点任意一行展开出金明细。</figcaption>
        </figure>
        <div class="hp-kv">
          <b>「当期 UP」这一列要留意</b>
          <ul>
            <li>平台<b>从数据反推</b> UP（当期抽到最多的那个五星即 UP）：角色池 <b>{{ a.bannersCoverage.ch.infer }}/{{ a.bannersCoverage.ch.total }}</b> 个池、
              光锥池 <b>{{ a.bannersCoverage.lc.infer }}/{{ a.bannersCoverage.lc.total }}</b> 个池推得出来。</li>
            <li><b>推不出来的原因是逻辑本身</b>：没抽到过 UP 就无从反推（显示「—」）。要 100% 覆盖得额外维护一张
              <code>gacha_id → UP</code> 的历史表 —— <b>这是已知局限，不是数据错误</b>。</li>
          </ul>
        </div>
      </section>

      <!-- ⑤ ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-5">5 · 出金明细怎么读 <small>池内第几抽 · 真实保底 · 吉凶</small></h2>
        <p class="hp-p">
          点开任意一个卡池行，展开的是<b>该池每一次出金</b>。三个数字的含义完全不同：
        </p>
        <table class="tb">
          <thead><tr><th>列</th><th>含义</th><th>容易误读的地方</th></tr></thead>
          <tbody>
            <tr><td><b>池内第几抽</b></td><td>只数<b>本池</b>自己的记录，这一抽在本池排第几（第 1 抽＝本池第一条记录）</td>
              <td>它<b>不是</b>「距上一次出金多少抽」，也<b>不能</b>用同类型池的全局序号相减去算 —— 并行池交错会把别的池的抽数累进来</td></tr>
            <tr><td><b>真实保底</b></td><td>距<b>上一个五星</b>实际抽了多少，<b>跨同类型的卡池累计</b>（角色池与光锥池各一套，互不相通）</td>
              <td>同一行里「池内第几抽」与「真实保底」通常不同，差多少＝中间有多少抽打在了同时上架的另一个池上</td></tr>
            <tr><td><b>吉凶</b></td><td>按<b>出金那一刻</b>算的万年历吉凶（见第 8 章）</td>
              <td>同一天不同时辰的黄黑道不同，所以同一天的吉凶会变</td></tr>
          </tbody>
        </table>
        <figure class="hp-fig">
          <img src="assets/help/05-detail.png" loading="lazy" alt="展开的出金明细">
          <figcaption><b>图 6</b>　展开面板：顶部胶囊是本池统计，圆点是每次出金在本池的落点（<b>UP 紫 / 歪 橙</b>），下面是明细表。</figcaption>
        </figure>
        <div class="hp-kv">
          <b>要点</b>
          <ul>
            <li>一整池窗口内的<b>第一金</b>，它的保底是从<b>保留期之前</b>续起来的 —— 链接里只看得到窗口内那段，明细表里显示的也是「窗口内能解析到的抽数」，会明显小于真实保底。</li>
            <li>平台有一条兜底断言：<b>任何池的「池内第几抽」最大值不得超过该池总抽数</b>；越界就直接报错，不渲染错数据。</li>
          </ul>
        </div>
      </section>

      <!-- ⑥ ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-6">6 · 角色管理怎么读 <small>星魂 / 叠影 / 三源合并 / 光锥归属</small></h2>
        <p class="hp-p">
          「角色管理」页有两块：<b>五星角色 × 专属光锥</b> 与 <b>五星光锥全览</b>。它们都是
          <b>「接口窗口 ＋ 工坊截图补录 ＋ 外部统计补录」三个来源合并</b>后的结果 —— 只看接口会让跨期数据残缺（比如长夜月、时节不居这两条金压在窗口边界上）。
        </p>
        <figure class="hp-fig">
          <img src="assets/help/06-roles.png" loading="lazy" alt="五星角色与专属光锥">
          <figcaption><b>图 7</b>　每格左边是角色、右边是他的专属光锥。<b>N 命</b> = 星魂等级，<b>叠 N</b> = 叠影等级，虚线圆圈 = 该专属光锥还没抽到。</figcaption>
        </figure>
        <figure class="hp-fig">
          <img src="assets/help/07-cones.png" loading="lazy" alt="五星光锥全览">
          <figcaption><b>图 8</b>　五星光锥全览，按命途分组。紫字 <b>专属·角色名</b> ＝ 限定池产出的专属光锥，灰字 <b>常驻·角色名</b> ＝ 常驻保底池那 7 张之一。</figcaption>
        </figure>
        <div class="hp-kv">
          <b>口径</b>
          <ul>
            <li><b>星魂 = 三源合并后抽到该角色的总金数 − 1</b>（上限 6）；<b>叠影 = 抽到该光锥的总张数</b>（上限 5）。</li>
            <li><b>跨界金不重复计</b>：保底跨接口窗口边界的那两条金（长夜月 / 时节不居），窗口内那条是残缺值，整条由截图段代表，只算一次。
              ⚠️ 必须按它自带的 <code>gacha_id</code> 精确排除，<b>不能按角色名整体排除</b> —— 那会误伤复刻池。</li>
            <li><b>前两源都可能缺</b>：接口缺窗口外的、截图缺窗口内的且只有五星那几行。所以纯靠抽卡记录算出的星魂/叠影是<b>下限</b>，不是绝对准确值 ——
              这正是第三源（外部统计）要补的那块，见 6.1。</li>
            <li><b>五星光锥归属有三类</b>：<code>专属·角色名</code>（该角色的专属光锥）· <code>常驻·角色名</code>（常驻池那 7 张之一）· <code>限定</code>。
              <b>角色池与光锥池是两套不同的常驻名单，绝不共用</b>（歪到常驻五星光锥只会在那 7 张里出）。</li>
            <li><b>数据来源标签</b>：彩色<b>实底</b> = 接口窗口解析所得；<b>虚线框</b> = 工坊截图补录（接口保留期之外）；
              紫色 <b>联动</b> = 联动池出货，单列一支、不按 UP/歪 读；标了<b>外部</b>的 = 命数取自外部统计补录（第三源）。</li>
          </ul>
        </div>

        <h3 class="hp-h3">6.1 第三源：外部统计补录 —— 把「真实持有状态」直接搬进来</h3>
        <p class="hp-p">
          前两源都只能从<b>抽卡记录</b>倒推命数，天生缺窗口外那段，所以算出来是<b>下限</b>。
          但你的账号真实持有状态其实随处可见：<b>游戏内的角色 / 光锥列表</b>、<b>星穹工坊的角色统计页</b>、<b>米游社 / HoyoLab 的抽卡统计</b>。
          这些渠道的好处是它们<b>本来就存了完整历史</b>（第三方是长期累积在云端的），坏处是<b>只有数、没有抽数</b>。
          平台的做法是：把这一路单独收成<b>第三源</b>，<b>只喂「星魂 / 叠影 / 持有清单」，绝不碰任何抽数与比率口径</b>。
        </p>
        <p class="hp-p">
          入口在<b>「抓取与数据管理 → ⑤ 外部统计补录」</b>，就在「修改记录」下面。流程是
          <b>上传截图 → 本机图标匹配预填 → 人工确认 → 保存到角色管理</b>：
        </p>
        <table class="tb">
          <thead><tr><th>步骤</th><th>做什么</th><th>为什么这么做</th></tr></thead>
          <tbody>
            <tr><td style="white-space:nowrap"><b>① 上传</b></td>
              <td>把截图拖进上传区（游戏内角色列表 / 工坊统计页 / 米游社统计页都行）</td>
              <td>截图会留档到 <code>data/uploads/</code>，事后能回溯「这条命数是哪张图看来的」</td></tr>
            <tr><td style="white-space:nowrap"><b>② 识别</b></td>
              <td>在<b>你自己的浏览器里</b>跑一遍图标检测 + 匹配，把确认表预填好</td>
              <td>平台是纯本地离线的，不能调云端大模型；而本机 <code>assets/</code> 里就有整套头像 / 光锥图标，
                截图里的图标就是<b>同一套原图</b>渲染出来的 → 拿本地图标做模板匹配最准，且零联网</td></tr>
            <tr><td style="white-space:nowrap"><b>③ 确认</b></td>
              <td>逐行看「图 / 类型 / 名字 / 星魂·叠影 / 分数」，错的手动改，缺的用「＋ 手动加一行」补</td>
              <td><b>识别只是把表预填好，不替你做决定</b>：截图分辨率、UI 皮肤、缩放都会影响命中率。
                「分数」是匹配的相似度，越低越可疑；<b>宁可标「未识别」也不要猜错</b>；名字框有本地全量候选可下拉补全</td></tr>
            <tr><td style="white-space:nowrap"><b>④ 保存</b></td>
              <td>点「保存到角色管理」→ 立刻写进角色管理页</td>
              <td>没在本地索引里找到的名字会被<b>拒绝写入并单独列出来</b>（<code>bad</code> 列表），不会污染数据</td></tr>
          </tbody>
        </table>
        <figure class="hp-fig">
          <img src="assets/help/10-external.png" loading="lazy" alt="外部统计补录卡片">
          <figcaption><b>图 9</b>　「抓取与数据管理 → ⑤ 外部统计补录」。上面是上传区与识别选项（默认「只匹配五星」），
            中间是截图预览（绿框 = 检出的图标位置），下面是识别后待确认的表：缩略图 + 类型 + 名字 + 星魂/叠影 + 分数。
            <b>这张演示图是合成的</b>（脚本在浏览器里画了一张「角色列表」风格的图再喂进去），分数只作示意。</figcaption>
        </figure>
        <div class="hp-kv">
          <b>四条必须说清楚的规则</b>
          <ul>
            <li><b>语义 = 真值快照，覆盖旧值。</b>外部渠道说的是你<b>当前真实持有</b>的命数，
              比「从抽卡记录反推」更可信 —— 所以两者不一致时<b>以外部为准</b>，并且在行内<b>显式标出冲突</b>
              （引擎会同时保留一份「抽卡推算值」，方便你回头核对）。</li>
            <li><b>单位按类型分，别填错：</b><b>角色</b>填的是<b>星魂等级 0~6</b>（0 = 就抽到过一个，没有额外星魂）；
              <b>光锥</b>填的是<b>叠影等级 1~5</b>（1 = 只有 1 张）。超出范围会被夹到边界。</li>
            <li><b>它不参与任何抽数口径。</b>总抽数、出金率、每 UP 抽数、小保底不歪<b>一个都不受它影响</b> ——
              因为它只有命数没有抽数，掺进去就没法自证了。这条在接口层就切开了，页面上也写明了。</li>
            <li><b>重传即整体覆盖。</b>同一对「类型 + 名字」只保留一条；重新保存会<b>整体替换</b>上一份外部统计，
              不会两份叠着算。想清空就用卡片上的「清空全部外部统计」。</li>
          </ul>
        </div>
        <div class="hp-warn">
          <b>识别不到是正常的，别把它当成「功能坏了」。</b>图标匹配要求截图里的图标和本机 <code>assets/</code> 是同一套原图；
          如果截图被裁过、加了水印、套了活动主题皮肤，或者那个角色本机的图标还没下载（<b>没抽到的角色不会有本地图标</b>），
          分数就会很低甚至检不出来。这时<b>手动加行</b>即可 —— 第三源的价值在于「有一份可信的持有状态」，
          而不在于「全自动认图」。
        </div>
      </section>

      <!-- ⑦ ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-7">7 · 这几个数字怎么算 <small>总抽数 · 出金率 · 每 UP · 小保底不歪</small></h2>
        <p class="hp-p">
          这一章把「数据总貌」每张卡片的口径逐条讲清楚。<b>先记住一条分界线</b>：
          <b>总量类</b>（总抽数 / 五星数）用<b>人工补填</b> —— 因为接口拿不到完整历史；
          <b>比率类</b>（出金率 / 每 UP / 小保底不歪）<b>全部基于本地导入的跃迁记录实时计算</b>，每导入一次就自动重算。
          两者的分母本来就不一样，<b>不是数据矛盾</b>。
        </p>

        <h3 class="hp-h3">7.1 总抽数 = 补填值 ＋ 之后新导入的记录</h3>
        <div class="hp-eq">
          总抽数 <b>{{ o.tot.p }}</b> ＝ 补填 <b>{{ o.wsBase.pulls }}</b>（快照时刻 <b>{{ o.wsAt }}</b>）
          ＋ 晚于快照时刻新导入的 <b>{{ o.inc.p }}</b> 抽　·　五星 <b>{{ o.tot.g }}</b> 同理
        </div>
        <p class="hp-p">
          「数据补填」里填的两个数就是<b>总量基准</b>，再叠加<b>快照时间之后新导入的记录</b>。
          这样你只要偶尔去看一眼总量、填一次，之后新抽的卡会自动长上去。
          <br>⚠️ 快照时间是<b>精确到秒的完整时刻</b>，而且<b>打开页面时会实时跟随当前时间</b>（每秒走）——
          你不动它就等于「记下点保存的那一刻」；手动改过就停止跟随，旁边有「↻ 跟随当前时间」可以恢复。
          <br>为什么一定要秒级：如果只按「日」切分，当天 00:00 之后抽的记录会全部落进增量，
          而它们通常已经包含在你刚填的那个数里，<b>会重复计数</b>。
          （手动只填到「日」也允许，引擎会按<b>该日结束 23:59:59</b> 处理。）
        </p>
        <figure class="hp-fig">
          <img src="assets/help/09-fill.png" loading="lazy" alt="数据补填卡片与修改记录">
          <figcaption><b>图 10</b>　「抓取与数据管理 → ④ 数据补填」。填总抽数 / 五星数与快照时间，点「保存并更新」即可；
            「近期总抽数起点」是<b>只读的</b>（引擎自动取本地仓最早记录，显示到秒）。下方「修改记录」把每次输入的字段原样留档。</figcaption>
        </figure>

        <h3 class="hp-h3">7.2 出金率</h3>
        <div class="hp-eq">
          出金率 <b>{{ r.rate }}%</b> ＝ 本地记录 <b>{{ r.g }}</b> 金 ÷ <b>{{ r.p }}</b> 抽（起点 <b>{{ r.from }}</b>，自动取本地最早一条）
        </div>
        <p class="hp-p">
          同时给两个对照：<b>剔除联动后的 {{ r.noLd.rate }}%</b>（{{ r.noLd.p }} 抽 / {{ r.noLd.g }} 金，与常规池可比）
          与<b>工坊全量口径的 {{ r.fullRate }}%</b>。三者同量级即说明解析无误 ——
          <b>联动池的出金规则不同</b>（限定池，不存在「歪到常驻」），所以不要只引用其中一个。
        </p>

        <h3 class="hp-h3">7.3 每 UP 角色 / 每 UP 光锥需多少抽</h3>
        <div class="hp-eq">
          每 UP 角色需 <b>{{ d.perUpCh }}</b> 抽 ＝ (角色池记录 {{ d.n11 }} − UP {{ d.linkChUp }} 次) ÷ {{ d.linkChUp }}　·　
          光锥 <b>{{ d.perUpLc }}</b> 抽 ＝ ({{ d.n12 }} − {{ d.linkLcUp }}) ÷ {{ d.linkLcUp }}
        </div>
        <table class="tb">
          <thead><tr><th>口径</th><th class="hn">每 UP 角色</th><th class="hn">每 UP 光锥</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td>本平台（导入记录）</td><td class="num">{{ d.perUpCh }}</td><td class="num">{{ d.perUpLc }}</td>
              <td><code>(池抽数 − UP 数) ÷ UP 数</code>，数据 = 本地 {{ d.list.length }} 条记录</td></tr>
            <tr><td>同一份数据、工坊式子</td><td class="num">{{ d.perUpChWsSame }}</td><td class="num">{{ d.perUpLcWsSame }}</td>
              <td><code>池抽数 ÷ UP 数</code> —— 与上一行<b>恒差 1.0 抽/UP</b>（差的正是 UP 数本身）</td></tr>
            <tr><td>工坊页面显示</td><td class="num">82.6</td><td class="num">52.9</td>
              <td>它的历史更完整（含接口保留期之外那些抽），且用它自己的式子</td></tr>
          </tbody>
        </table>
        <p class="hp-p">
          <b>只用本地导入的记录算，不掺截图补录</b> —— 补录那份是写死的常量，掺进来就不满足「每次导入都要实时更新」这条要求。
          所以别拿工坊那两个数字直接对：<b>口径差（1.0 抽/UP）＋ 数据范围差（补录那部分历史）</b>叠加起来才是差值。
        </p>

        <h3 class="hp-h3">7.4 小保底不歪</h3>
        <div class="hp-eq">
          角色 <b>{{ d.smallCh.rate }}%</b> ＝ (UP {{ d.smallCh.up }} − 歪 {{ d.smallCh.off }}) ÷ {{ d.smallCh.up }}　·　
          光锥 <b>{{ d.smallLc.rate }}%</b> ＝ (UP {{ d.smallLc.up }} − 歪 {{ d.smallLc.off }}) ÷ {{ d.smallLc.up }}
        </div>
        <p class="hp-p">
          <b>定义：</b>抽到的 UP 里，有多少次是<b>小保底直接出</b>（而不是「先歪常驻、下一个金才必出 UP」的大保底兑现）。
          算法就是把该池的<b>歪次数从 UP 次数里减掉</b> —— 因为每一次歪都会被随后的一个 UP 兑现：
          角色池 <b>{{ d.smallCh.up }} 个 UP 里，{{ d.smallCh.off }} 个是大保底兑现、剩下 {{ d.smallCh.direct }} 个是小保底直出</b>。
        </p>
        <div class="hp-kv">
          <b>三个要说清楚的点</b>
          <ul>
            <li><b>为什么分角色 / 光锥两个数</b>：两个池的 UP 名单与保底都独立，合起来算会互相稀释。</li>
            <li><b>唯一会失真的情形</b>：本地记录里该池「最后一颗金是歪」（这次歪还没兑现成 UP）→ 会少算一次小保底。
              这时卡片小字会标出「<b>末次出金是歪、尚未兑现</b>」，一眼能看见。</li>
            <li><b>同样只用导入记录算</b>，与工坊显示的是同一个算法（工坊那 54.3% 是它含更完整历史的版本，量级可比）。</li>
          </ul>
        </div>

        <h3 class="hp-h3">7.5 截图补录：怎么读出来的、怎么验的</h3>
        <p class="hp-p">
          接口保留期之外那段来自你给的工坊截图：先用本地图标库对每个头像做<b>模板匹配</b>，再把匹配结果与截图裁切
          <b>并排放大逐行目视核对</b>；另用「抽数条的像素宽与抽数成线性」做交叉校验（最小二乘拟合残差 0.0 ~ 0.4px 即读数无误）。
          「歪」沿用截图上的红色印章，不做二次推断。衔接自洽性也验过：截图段共 <b>{{ d.histOff }}</b> 次「歪」，
          时间上紧跟其后的那个金<b>全部是 UP</b>，与「歪之后下一个金必是 UP」一致。
        </p>
        <p class="hp-p">
          最硬的一条验证在常驻池：它是<b>唯一抽数与截图能逐条核对</b>的池（保底线性、没有「歪」的概念）——
        </p>
        <table class="tb">
          <thead><tr><th>核对项</th><th class="hn">数值</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td>窗口内出金</td><td class="num">{{ gq.n }}</td><td>这几颗金在接口里逐条可见，抽数 <b>{{ gq.pities.join(' / ') }}</b> 与截图补录<b>完全相等</b></td></tr>
            <tr><td>最旧那颗「{{ gq.oldestName }}」</td><td class="num">{{ gq.full }}</td>
              <td>接口只看到其中 <b>{{ gq.inWin }}</b> 抽，剩下 <b>{{ gq.carry }}</b> 抽垫在保留期之外、截图里才有 → 合起来 {{ gq.full }} 抽</td></tr>
          </tbody>
        </table>
        <div class="hp-warn">
          <b>⚠️ 这份补录现在只服务「角色管理」页的星魂 / 叠影</b>（那两项本来就要跨期合并），
          <b>不再参与</b>出金率 / 每 UP / 小保底不歪 —— 因为它不会随导入变化。
          它和 6.1 讲的<b>外部统计补录</b>是两件事：这份是「从工坊截图里读出来的<b>逐条抽卡明细</b>（带抽数）」，
          那份是「从任意渠道截图里读出来的<b>当前持有状态</b>（只有命数）」。
        </div>

        <h3 class="hp-h3">7.6 三个仍然要当心的地方</h3>
        <ul class="hp-ul">
          <li><b>剔重的三处</b>：工坊截图是<b>最新在上</b>（倒序），最上面几行其实已经落在接口窗口内 ——
            角色池「姬子 74 抽」＝ 窗口内 <code>2092</code> 池第 60 抽那条；
            角色池「长夜月 76 抽」与光锥池「时节不居 50 抽」的保底<b>跨窗口边界</b>（链接里只看得到 <b>{{ d.crossPity.ch }} / {{ d.crossPity.lc }}</b> 抽），
            截图给的是完整值（76 / 50）。三处都<b>只算一次</b>，否则同一笔抽卡会被算两遍。</li>
          <li><b>「已垫 N 抽」是最容易写错的输入</b>：每个池的「当前已垫」直接加进该池总量（定义见第 2 章）。
            本账号曾因为把常驻跃迁的已垫写成 50（实际 51）而<b>正好差 1 抽</b>。
            正确做法：<b>该值必须能用接口自算复核</b> —— 该池窗口内最后一个五星之后的记录条数就是当前已垫
            （角色 {{ boundsOf('11') }} / 光锥 {{ boundsOf('12') }} / 常驻 <b>{{ boundsOf('1') }}</b> 抽）。</li>
          <li><b>别把「外部统计」当抽数用</b>：6.1 那条第三源<b>只有命数、没有抽数</b>，所以它绝不会进总抽数 / 出金率 / 每 UP /
            小保底不歪的分母。看到角色管理页的星魂变了、而出金率一动不动，这是<b>设计如此</b>，不是数据没更新。</li>
        </ul>
      </section>

      <!-- ⑧ ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-8">8 · 吉凶是怎么算的 <small>离线万年历，日家 + 时家黄黑道</small></h2>
        <p class="hp-p">
          每次出金都会按<b>出金那一刻</b>补一个吉凶。用的是内置的万年历引擎（<b>完全离线、不联网</b>），
          取的都是「万年历共有信息」：<b>日家</b>十二天神（黄道 / 黑道）、建除十二神、二十八宿、当日宜忌，以及<b>时家</b>十二天神。
        </p>
        <div class="hp-two">
          <div class="hp-card">
            <div class="hp-card-h">评级规则（日为主、时为辅）</div>
            <div class="hp-card-b">
              日黄道 ＋ 时黄道 = <span class="jxb j1">大吉</span>　·　日黄道 ＋ 时黑道 = <span class="jxb j2">吉</span><br>
              日黑道 ＋ 时黄道 = <span class="jxb p">平</span>　·　日黑道 ＋ 时黑道 = <span class="jxb x">凶</span>
            </div>
          </div>
          <div class="hp-card">
            <div class="hp-card-h">为什么同一天吉凶会变</div>
            <div class="hp-card-b">同一天里<b>每个时辰的黄黑道都不一样</b>，所以同一个日子的吉凶会随时辰变化。
              鼠标悬停徽章可以看到该时刻的干支、建除、星宿与当日宜忌。</div>
          </div>
        </div>
        <div class="hp-note">这是个<b>趣味指标</b>：它只是把抽卡时间对齐到万年历上，<b>与出金概率没有任何因果关系</b>，别拿它做决策依据 :)</div>
      </section>

      <!-- ⑨ ─────────────────────────────────────────────────────────────── -->
      <section class="hp-sec">
        <h2 id="hp-9">9 · 日常维护手册 <small>什么时候需要动什么</small></h2>
        <table class="tb">
          <thead><tr><th>你做了什么</th><th>平台要做什么</th><th>怎么做</th></tr></thead>
          <tbody>
            <tr><td>又抽了卡（任意池）</td><td>增量同步记录、自动补新角色/光锥图标</td>
              <td><b>抓取与数据管理</b> → 贴一条新的抽卡链接 → 抓取。历史永远取并集、不会覆盖；<b>出金率 / 每 UP / 小保底不歪会自动重算</b>。</td></tr>
            <tr><td>重新看了一次总量数字</td><td>更新「数据补填」的总抽数 / 五星数</td>
              <td><b>抓取与数据管理 → ④ 数据补填</b>：填两个数 + 快照时间（默认 = 现在，秒级实时跟随）→「保存并更新」。其余口径全自动衍生，下方会追加一条修改记录。</td></tr>
            <tr><td>重新截了工坊的卡池明细</td><td>更新「已垫 N 抽」与补录行</td>
              <td>改 <code>core/pools.js</code>；<b>改完必须用接口自算复核「已垫」</b>（见 7.6 的警告）。</td></tr>
            <tr><td>发现某个角色的星魂 / 叠影偏低</td><td>用第三源把真实持有状态补进来</td>
              <td><b>抓取与数据管理 → ⑤ 外部统计补录</b>：传一张游戏内角色列表 / 工坊统计页截图 → 核对确认表 → 保存。
                它会<b>覆盖</b>抽卡推算值，且<b>不影响任何抽数比率</b>（见 6.1）。</td></tr>
            <tr><td>发现某处数字对不上</td><td>先分清是「总量」还是「比率」</td>
              <td>总量看<b>④ 数据补填</b>里生效的基准；比率看本页第 7 章的口径，再对「数据管理 → ③ 各卡池时间边界」的记录数。</td></tr>
          </tbody>
        </table>
        <details class="fold hp-faq">
          <summary>常见疑问 <span class="fsm">点开看 4 条</span></summary>
          <div class="hp-kv">
            <ul>
              <li><b>为什么不能一条链接还原我的全部历史？</b>接口只保留约 1 年且是滑动窗口，早期的记录服务器已经删了、不可恢复。
                第三方的全量数字是它长期累积在云端的，本机拿不到。</li>
              <li><b>数据会上传吗？</b>不会。服务只跑在 <code>127.0.0.1</code>，记录存在本机 <code>data/records.json</code>，
                只有抓取那一瞬间会向官方接口发请求。</li>
              <li><b>怎么把历史补得更全？</b>两条路：从现在起每次抽完都抓一次（并集会越来越长）；
                或者导入第三方工具导出的 <b>UIGF / SRGF</b> 记录文件。</li>
              <li><b>星魂 / 叠影为什么可能比实际低？</b>因为从抽卡记录算只能拿到接口窗口内那段，窗口外的金看不到，
                算出来自然是<b>下限</b>。要补两条路：<b>持续同步</b> / 导入完整记录文件，或者直接用<b>第三源</b>
                （「数据管理 → ⑤ 外部统计补录」，见 6.1）—— 后者不依赖历史，直接把当前真实持有状态搬进来。</li>
            </ul>
          </div>
        </details>
      </section>

      <div class="foot">
        本页只解释口径，不产生新数据 · 所有计算都在本机完成<br>
        截图拍摄于 2026-09-16，随数据更新可能与你屏幕上的数字略有出入
      </div>
    </div>`,
  };
})();
