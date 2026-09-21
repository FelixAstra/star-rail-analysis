// ─────────────────────────────────────────────────────────────────────────────
// 「抽卡分析」页 —— 把原来那张 206KB 静态验证页的 7 个板块拆成 Vue 组件
//
// 渲染用的类名与原静态页**保持一致**（.pool / .pool-head / .pc / .c / .tb …），
// 这样之前逐像素核对过的对齐约定（表头与单元格同对齐、一格只放一行、
// 列内起点不许按数据长短分叉）全部原样继承，样式表 styles.css 直接复用。
//
// 2026-09-16（需求 1.1）：把各板块的长段解释文字**移到「解释说明」页**，
// 这里每块只留一行结论 + 一个 .rd-more 跳转（跨页靠 inject:['goto']）。
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const W = window.W = window.W || {};
  const { ref, computed, nextTick } = Vue;
  const GOTO = { inject: ['goto'] };

  // ── 图例（现在挂在「角色管理」页，说明下面两张图怎么读）─────────────────
  W.Legend = {
    template: `
    <h2>怎么看这两张图</h2>
    <div class="lg">
      <div class="it"><span class="lg-t">角色 ＋ 专属光锥</span>每格左边是角色，右边是他的<b>专属光锥</b>（同期上架的那张）</div>
      <div class="it"><span class="lg-t">角色右下角 N 命</span>＝ <b>星魂等级</b>（抽到该角色 N+1 次）</div>
      <div class="it"><span class="lg-t">光锥右下角 叠 N</span>＝ <b>叠影等级</b>（抽到该光锥 N 张）</div>
    </div>
    <div class="lg" style="margin-top:8px">
      <div class="it"><span class="lg-t">虚线圆圈</span>＝ 该角色的专属光锥本账号还没抽到</div>
      <div class="it"><span class="pl up">74抽<b>UP</b></span> 第 74 抽出货，且是当期 UP（实底 = 接口窗口）</div>
      <div class="it"><span class="pl off">81抽<b>歪</b></span> 第 81 抽出货，但歪到常驻</div>
      <div class="it"><span class="pl h up">76抽<b>UP</b></span> <b>虚线框</b>＝ 来自工坊截图补录（接口拿不到）</div>
      <div class="it"><span class="pl std">69抽<b>常驻</b></span> 群星（常驻）池出货，普池没有 UP 概念</div>
      <div class="it"><span class="pl std">10抽<b>新手</b></span> 始发（新手）池出货，同样没有 UP 概念</div>
      <div class="it"><span class="pl ld">78抽<b>联动</b></span> 联动池出货（记录走 <code>getLdGachaLog</code> 端点），单列一支、不与常规 UP 混</div>
    </div>
    <div class="lg" style="margin-top:8px">
      <div class="it"><span class="ring"><i></i></span> 金环 = 五星</div>
      <div class="it"><span class="ring r4"><i></i></span> 紫环 = 四星</div>
      <div class="it"><span class="ring r3"><i></i></span> 蓝环 = 三星</div>
    </div>`,
  };

  // ── 数据总貌 ────────────────────────────────────────────────────────────
  // 2026-09-16（需求 1.2-3）：卡片下方那段长说明已删除 —— 具体计算逻辑统一收在「解释说明」第 1 / 7 章，
  // 这里只留每张卡片自己那一行小字（口径公式）。
  W.Overview = {
    ...GOTO,
    props: { a: Object },
    computed: { r() { return this.a.overview.recent; }, o() { return this.a.overview; } },
    template: `
    <h2>数据总貌 <small>总量来自「数据补填」，比率类指标全部基于本地导入的跃迁记录实时计算</small></h2>
    <div class="sts">
      <w-stat-card v-for="s in a.overview.stats" :key="s.key" :s="s"></w-stat-card>
    </div>`,
  };

  // ── 各卡池时间边界（现在渲染在「抓取与数据管理」页，bare=true 时由外层卡片给标题）──
  W.PoolBounds = {
    ...GOTO,
    props: { a: Object, bare: Boolean },
    computed: { rows() { return this.a.poolBounds; }, gq() { return this.a.gqCheck; } },
    template: `
    <h2 v-if="!bare">各卡池时间边界 <small>用于确认接口可回溯的窗口</small></h2>
    <table class="tb"><thead><tr><th>卡池</th><th class="hn">记录数</th><th>最早记录</th><th>最晚记录</th><th class="hn">跨度</th><th class="hn">五星</th><th class="hn">已垫抽数</th></tr></thead><tbody>
      <tr v-for="p in rows" :key="p.gt">
        <td>{{ p.name }}<span v-if="p.isLd" class="pl ld" style="margin-left:6px">另一端点</span></td>
        <td class="num">{{ p.n }}</td>
        <td class="mono">{{ p.first.slice(0,16) }}</td>
        <td class="mono">{{ p.last.slice(0,16) }}</td>
        <td class="num">{{ p.days }} 天</td>
        <td class="num">{{ p.gold }}</td>
        <td class="num">{{ p.cur }} / {{ p.hard }}</td>
      </tr>
    </tbody></table>
    <div class="slim-hint" style="margin-top:10px">
      「已垫抽数」＝距该池最近一次出金之后又抽了多少（<code>/90</code> <code>/80</code> <code>/50</code> 为保底上限）；
      标「另一端点」的两行走 <code>getLdGachaLog</code>，<b>跨度长是因为按 <code>gacha_type</code> 合并了历史上多期</b>，不代表连开一年。
      常驻池已与接口逐条校验通过（{{ gq.pities.join(' / ') }} 抽）。
      <span class="rd-more" @click="goto('help')">两条端点 / 滑动窗口 →</span>
    </div>`,
  };

  // ── 卡池出金明细（展开面板）─────────────────────────────────────────────
  W.PoolDetail = {
    props: { d: Object },
    template: `
    <div class="pool-detail">
      <div class="pool-chips">
        <span class="pool-chip"><b>{{ d.chips.n }}</b>池内抽数</span>
        <span class="pool-chip"><b>{{ d.chips.gold }}</b>五星</span>
        <span class="pool-chip"><b>{{ d.chips.rate }}</b>出金率</span>
        <span class="pool-chip"><b>{{ d.chips.avg === null ? '—' : d.chips.avg }}</b>抽 / 金</span>
      </div>
      <template v-if="d.rows.length">
        <div class="pool-bars">
          <div class="pool-base"></div>
          <span v-for="dt in d.dots" :key="dt.i" class="pool-dot" :class="dt.up ? 'up' : 'off'"
                :style="{ '--r': dt.r }" :title="'池内第 ' + dt.inPool + ' 抽 · ' + dt.name">{{ dt.i }}</span>
          <span class="pool-tick l">1</span><span class="pool-tick r">{{ d.chips.n }}</span>
        </div>
        <table class="pool-table">
          <thead><tr><th class="c">池内第几抽</th><th>抽取时间</th><th>抽到的物品</th><th class="c">真实保底</th><th>吉凶</th></tr></thead>
          <tbody>
            <tr v-for="r in d.rows" :key="r.inPool + r.time">
              <td class="num">{{ r.inPool }}</td>
              <td class="mono">{{ r.time }}</td>
              <td>{{ r.name }}<i class="offm" v-if="r.off">歪</i></td>
              <td class="num">{{ r.pity }}</td>
              <td class="jx"><span class="jxb" :class="r.alm.level" :title="r.alm.detail">{{ r.alm.label }}</span><span class="jxt">{{ r.alm.short }}</span></td>
            </tr>
          </tbody>
        </table>
        <div class="pool-fine">
          <b>「池内第几抽」</b>：只数本池（gacha_id <b>{{ d.fine.gid }}</b>）自己的 {{ d.fine.n }} 条记录，这一抽在本池排第几，第 1 抽就是本池第一条。<br>
          <b>「真实保底」</b>：距上一个五星实际抽了多少，<b>跨同类型的卡池累计</b>（角色池与光锥池各自一套，互不相通）。<template v-if="d.fine.jumped">本池有 <b>{{ d.fine.jumpedCount }}</b> 个金两者不同 —— 如第 <b>{{ d.fine.jumped.inPool }}</b> 抽出的「{{ d.fine.jumped.name }}」真实保底 <b>{{ d.fine.jumped.pity }}</b> 抽，说明中间有 {{ d.fine.jumped.diff }} 抽抽在了同时上架的另一个池上。</template><template v-else>本池出金的两个数字恰好一致。</template><template v-if="d.fine.carry"><br><b>注：</b>第 <b>{{ d.fine.carry.inPool }}</b> 抽的「{{ d.fine.carry.name }}」是本池在接口窗口内的<b>第一金</b>，它的保底是从<b>保留期之前</b>续起来的，所以这里显示的是<b>窗口内能解析到的 {{ d.fine.carry.pity }} 抽</b>，不含接口已经查不到的那段垫抽。</template>
        </div>
      </template>
      <div class="pool-empty" v-else>本池窗口内共抽了 <b>{{ d.chips.n }}</b> 抽，<b>没有五星</b>。</div>
    </div>`,
  };

  // ── 当期卡池识别（页签 + 行表 + 一键收折）────────────────────────────────
  // 页签用「隐藏 radio + label」的原生方案（CSS 兄弟选择器负责高亮），
  // 「一键收折」是全页唯一必须上 JS 的地方 —— <details open> 是 DOM 状态，CSS 复位不了。
  W.BannerTabs = {
    ...GOTO,
    props: { a: Object },
    setup(props) {
      const tab = ref(props.a.banners.length ? props.a.banners[0].gt : '11');
      const boxEl = ref(null);
      const rowsEl = ref(null);
      const openCount = ref(0);

      // ⚠️ 只统计「当前可见页签」里的展开行：隐藏页签里的行虽然还是 open，
      //    用户看不见，计进去会让按钮上的数字与眼前不一致。
      const visibleRows = () => rowsEl.value
        ? Array.from(rowsEl.value.querySelectorAll('.pool-row')).filter(d => d.offsetParent !== null)
        : [];
      const sync = () => { openCount.value = visibleRows().filter(d => d.open).length; };

      // toggle 事件**不冒泡**，所以得在容器上用捕获阶段监听
      const onToggle = () => { nextTick(sync); };

      const fold = () => {
        visibleRows().forEach(d => { if (d.open) d.open = false; });
        nextTick(() => {
          sync();
          // 收完之后把视口带回板块顶部，否则用户还在几百行之下
          if (boxEl.value) boxEl.value.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      };

      return { tab, boxEl, rowsEl, openCount, onToggle, fold, sync };
    },
    computed: { coverage() { return this.a.bannersCoverage; } },
    template: `
    <h2>当期卡池识别 <small>角色池 {{ coverage.ch.infer }}/{{ coverage.ch.total }} 个卡池、光锥池 {{ coverage.lc.infer }}/{{ coverage.lc.total }} 个卡池可由数据自身推出 UP</small></h2>
    <div class="note slim">
      <b><code>gacha_id</code> 只表示「哪一池」</b>，所以本表<b>按它归并</b>（一个卡池一行）；
      「时间区间」是该池<b>首末抽卡时间</b>，<b>不是在架时长</b>。
      「来源」三色：<span class="tg ok">出金</span> 抽到过当期 UP ·
      <span class="tg bad">歪常驻</span> 出金但一次 UP 都没抽到 ·
      <span class="tg dim">未出金</span> 窗口内无金。
      点任意一行展开<b>出金明细</b>（池内第几抽 · 真实保底 · 吉凶）。
      <span class="rd-more" @click="goto('help')">gacha_id 切池规则 / UP 推定 / 吉凶算法 →</span>
    </div>

    <div class="btabs" ref="boxEl">
      <input v-for="b in a.banners" :key="b.gt" class="btab" type="radio" name="bt"
             :id="'bt-' + b.gt" :value="b.gt" v-model="tab">
      <div class="btbarrow">
        <div class="btbar">
          <label v-for="b in a.banners" :key="b.gt" :for="'bt-' + b.gt">{{ b.short }}<b>{{ b.count }}</b></label>
        </div>
        <button type="button" class="pool-fold" :disabled="!openCount" @click="fold"
                :title="openCount ? '收起当前页签里已展开的 ' + openCount + ' 个卡池明细' : '当前没有展开的卡池明细'">
          <span class="pf-i">⌃</span>一键收折<b class="pf-n">{{ openCount }}</b>
        </button>
      </div>
      <div class="btpanes" ref="rowsEl" @toggle.capture="onToggle">
        <div v-for="b in a.banners" :key="b.gt" class="bpane" :class="'bpane-' + b.gt">
          <div class="btop">
            <div class="bcap">{{ b.full }} · <code>gacha_type={{ b.gt }}</code> · 共 <b>{{ b.count }}</b> 个卡池，其中 <b>{{ b.inferCount }}</b> 个的当期 UP 可由数据自身推出</div>
            <div class="phint">点击任意一行展开出金明细 · 可同时展开多个 · 开太多时用右上角「一键收折」</div>
          </div>
          <div class="pool">
            <div class="pool-head">
              <span>gacha_id</span><span>时间区间</span><span class="hn">抽数</span>
              <span class="hn">五星数</span><span>构成</span><span>当期 UP</span><span>来源</span><span></span>
            </div>
            <details class="pool-row" v-for="r in b.rows" :key="r.gid">
              <summary>
                <span class="pool-cell mono">{{ r.gid }}</span>
                <span class="pool-cell mono dim2">{{ r.st.slice(0,10) }} → {{ r.en.slice(0,10) }}</span>
                <span class="pool-cell num">{{ r.n }}</span>
                <span class="pool-cell num">{{ r.goldCount }}</span>
                <span class="pool-cell pool-comp" :title="r.compText">
                  <template v-for="(c, i) in r.comp" :key="c.name + i"><span class="sp" v-if="i">+</span>{{ c.name }}<template v-if="c.n > 1">×{{ c.n }}</template><i class="offm" v-if="c.off">歪</i></template>
                  <template v-if="!r.comp.length">—</template>
                </span>
                <span class="pool-cell pool-up" :class="{ cone: r.gt === '12', dim2: r.up.src !== 'auto' }">
                  <template v-if="r.up.src === 'auto'">
                    <template v-for="(x, i) in r.up.list" :key="x.name">
                      <span class="upsl" v-if="i">/</span>
                      <img class="upav" loading="lazy" :src="'assets/' + x.dir + '/' + x.id + '.png'" :alt="x.name" :title="x.name"><b>{{ x.name }}</b>
                    </template>
                  </template>
                  <template v-else>—</template>
                </span>
                <span class="pool-cell"><span class="tg" :class="r.srcTag">{{ r.srcText }}</span></span>
                <span class="pool-arrow">▾</span>
              </summary>
              <w-pool-detail :d="r.detail"></w-pool-detail>
            </details>
          </div>
        </div>
      </div>
    </div>`,
    mounted() { this.sync(); },
    updated() { this.sync(); },
  };

  // ── 五星角色 × 专属光锥 ─────────────────────────────────────────────────
  W.PairGrid = {
    props: { a: Object },
    computed: { list() { return this.a.u5c; }, miss() { return this.a.missCone; } },
    template: `
    <h2>五星角色 × 专属光锥 <small>{{ list.length }} 个角色 · 右侧是该角色的专属光锥 · 数据来自「接口窗口 + 截图补录」两个来源</small></h2>
    <div class="pgrid">
      <div class="pc" v-for="c in list" :key="c.id">
        <div class="prow">
          <div class="cw2" :style="{ background: 'conic-gradient(from 210deg,#e8b95f,#fdf3d8,#d9a03c,#fdf3d8,#e8b95f)' }">
            <img loading="lazy" :src="'assets/avatar/' + c.id + '.png'" :alt="c.name">
            <span class="ck" :title="'星魂 ' + c.rank + '（共 ' + c.copies + ' 个）'">{{ c.rank }}命</span>
          </div>
          <span class="pconn">+</span>
          <div v-if="c.lcOwned" class="lw2" :style="{ background: 'conic-gradient(from 210deg,#e8b95f,#fdf3d8,#d9a03c,#fdf3d8,#e8b95f)' }"
               :title="c.lcName + '　叠影 ' + c.lcSup + '（共 ' + c.lcCopies + ' 张 · ' + c.lcSrcText + '）'">
            <img loading="lazy" :src="'assets/light_cone/' + c.lcId + '.png'" :alt="c.lcName">
            <span class="ck lk" :title="'叠影 ' + c.lcSup">叠{{ c.lcSup }}</span>
          </div>
          <div v-else class="lw2 empty" :title="'专属光锥「' + c.lcName + '」本账号还没抽到'"><span>—</span></div>
        </div>
        <div class="pn">{{ c.name }}</div>
        <div class="pm">{{ c.pathCn }} · {{ c.srcText }}{{ c.poolMark }}</div>
        <div class="cpl"><w-pull-tag v-for="(t, i) in c.tags" :key="i" :t="t"></w-pull-tag></div>
        <div v-if="c.lcId" class="pcx" :class="{ miss: !c.lcOwned }">专属 · {{ c.lcName }}<template v-if="!c.lcOwned"> · 未获得</template></div>
      </div>
    </div>`,
  };

  // ── 五星光锥全览 ────────────────────────────────────────────────────────
  W.ConeGrid = {
    props: { a: Object },
    computed: {
      list() { return this.a.u5l; },
      limited() { return this.a.u5l.filter(x => !x.isStd).length; },
      std() { return this.a.u5l.filter(x => x.isStd).length; },
    },
    template: `
    <h2>五星光锥全览 <small>{{ list.length }} 张 · 按命途分组 · 右下角为叠影等级</small></h2>
    <div class="grid g5l">
      <div class="c ar5" :class="{ stdl: x.isStd }" v-for="x in list" :key="x.id">
        <div class="cw" style="--ring:#e0a44a">
          <img loading="lazy" :src="'assets/light_cone/' + x.id + '.png'" :alt="x.name">
          <span class="ck" :title="'叠影 ' + x.sup + '（共 ' + x.copies + ' 张 · ' + x.srcText + '）'">叠{{ x.sup }}</span>
        </div>
        <div class="cn">{{ x.name }}</div>
        <div class="cm">{{ x.ownerKind }}<template v-if="x.owner">·{{ x.owner }}</template></div>
        <div class="cp">{{ x.pathCn }}</div>
      </div>
    </div>`,
  };

  // ── 数据校验（对账）────────────────────────────────────────────────────
  // 2026-09-16（需求 1.2-4）：本组件已下线 —— 用户要求删掉「数据校验：与工坊对账」这块内容，
  // 连带抽卡分析页页头那个「对账」徽章也一起去掉（它的跳转目标没了）。
  // 引擎里的 audit 字段保留：它是「逐池合计 === 总抽数」那条断言的载体，仍在校验数据自洽，
  // 其中一部分实时值（逐池拆分 / 剔重三处 / 常驻逐条）继续喂「解释说明」页。

  // ── 「抽卡分析」整页 ────────────────────────────────────────────────────
  W.AnalysisPage = {
    props: { a: Object },
    inject: ['goto'],
    template: `
    <div class="wrap">
      <div class="pagehead">
        <div>
          <h1>抽卡分析</h1>
          <div class="sub">UID <b>{{ a.uid }}</b> · 数据区间 <b>{{ a.dataRange.from.slice(0,10) }} → {{ a.dataRange.to.slice(0,10) }}</b>
            · 本地累计 <b>{{ a.dataRange.total }}</b> 条记录 · 分析于 {{ a.generatedAtLocal }}</div>
        </div>
        <div class="pg-actions">
          <span class="pill" style="cursor:pointer"
                title="点这里维护补填的总量基准（在「数据管理」页）" @click="goto('data')">
            总量基准：{{ a.overview.wsBase.pulls }} 抽 / {{ a.overview.wsBase.gold }} 金 · 补填于 {{ a.overview.wsAt }}
          </span>
        </div>
      </div>
      <div class="pgnav">
        <span>这一页只放<b>当期结论</b>；口径与理由在「解释说明」，抓取 / 卡池边界 / 数据补填在「数据管理」→</span>
        <button class="btn" title="9 章说明书：每个数字的来源与口径" @click="goto('help')">ⓘ 解释说明</button>
        <button class="btn" title="五星角色 × 专属光锥 / 五星光锥全览" @click="goto('roles')">✦ 角色管理</button>
        <button class="btn" title="各卡池时间边界 / 数据补填 / 抓取与同步" @click="goto('data')">⇅ 数据管理</button>
      </div>
      <w-overview :a="a"></w-overview>
      <w-banner-tabs :a="a"></w-banner-tabs>
      <div class="foot">
        头像与名称资源：本地 <code>assets/</code>（源自公开的角色资源库，抓取时自动补齐缺失图标）<br>
        本平台在你自己电脑上运行，数据只存在本机 <code>data/</code>，不联网上传任何内容
      </div>
    </div>`,
  };
})();
