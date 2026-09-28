// ─────────────────────────────────────────────────────────────────────────────
// 「卡池节奏」页 —— 你在每个卡池开放期的哪个阶段抽到了五星？
//
// 时间单位是**每个真实卡池自己的开放区间**（由 core/banner-phase.js 与随代码发布的
// core/banner-history.json 给出），不是版本上/下半 —— 同一个版本里可以同时开着整版池
// 和半期池，同一颗金在两个池里可能一个算中期、一个算后期。
//
// 页面只做三件事：把结论说成人话、把覆盖与排除摊开、把每个数字指回具体记录。
// 数据由 /api/banner-timing 在本机算好，不联网，也绝不改写任何原始记录。
//
// ⚠️ 三条纪律（与 core/banner-phase.js 同源，改动时一起看）：
//   ① 页面**不重算**阶段，只渲染引擎给的 phase / 覆盖数与排除原因 —— 图上任何一个点都必须
//      能追回一条本地记录，所以这里不做「按天数粗略分三段」这类二次加工。
//   ② 占比的分母是「当前筛选下、已确认归期且阶段可判定」的量。抽数分布与五星分布**并排**，
//      不用一根金色高柱暗示「这个阶段更容易出金」。
//   ③ 文案一律描述性：前/中/后改变不了官方概率，只能说「你在这段抽了多少、出了多少」。
//
// ⚠️ 所有会显示出来的中文都必须经过 t()，而且键要写成**字面量**（不能是查表结果）——
//    否则 tools/lib/i18n-keys.js 扫不到，en 模式下会静默漏译。所以下面这些
//    phaseLabel / slotLabel / reasonLabel 都写成显式分支，不用对象查表。
// ⚠️ 内容层（刻意不翻译）：卡池活动名（跃迁名，如「激浪跃金」）+ 历史表的来源/口径原话，
//    统一挂在 .bp-cn 上（verify-i18n 白名单按这个区域类收口，不是「什么都放行」）；
//    角色/光锥名走 n() 查官方英文名，绝不自己译。
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const W = window.W = window.W || {};
  const { ref, computed, onMounted, onUnmounted, watch } = Vue;
  const t = k => W.I18N.t(k);

  const POOL_SETS = [{ k: 'normal' }, { k: 'ch' }, { k: 'lc' }, { k: 'ld' }];

  function phaseLabel(k) {
    if (k === 'early') return t('前期');
    if (k === 'mid') return t('中期');
    if (k === 'late') return t('后期');
    return '—';
  }
  function phasePartLabel(k) {
    if (k === 'early') return t('开放期的前 1/3');
    if (k === 'mid') return t('开放期的中间 1/3');
    if (k === 'late') return t('开放期的最后 1/3');
    return '';
  }
  function slotLabel(s) {
    switch (s) {
      case '上半': return t('上半');
      case '下半': return t('下半');
      case '全版': return t('全版');
      case '第一期': return t('第一期');
      case '第二期': return t('第二期');
      case '第三期': return t('第三期');
      case '上半复刻': return t('上半复刻');
      case '下半复刻': return t('下半复刻');
      case '联动第二弹': return t('联动第二弹');
      default: return s == null ? '' : String(s);
    }
  }
  function srcLabel(k) {
    switch (k) {
      case 'up': return t('按五星 UP 认领');
      case 'shared-window': return t('同期池起止相同');
      case 'boundary-window': return t('落在端点不确定带');
      case 'open-ended': return t('长期开放');
      default: return t('区间唯一命中');
    }
  }
  function reasonLabel(code) {
    switch (code) {
      case 'ambig-multi': return t('同类型的多个卡池区间都容得下本 ID 的全部记录，且算出的阶段不同，需要人工确认是哪一池。');
      case 'ambig-loose': return t('放宽到端点不确定带后仍有多个候选卡池。');
      case 'unmapped-span': return t('记录的起止跨出了候选卡池区间，同一 gacha_id 可能对应多次开放。');
      case 'unmapped-nocover': return t('本地历史表里还没有覆盖这个 ID 的开放区间。');
      case 'ld-multi-open': return t('该 ID 的记录跨度长达数月，而公开资料未给出可核实的开放实例；联动跃迁还有「长期开放」形态。记录跨度本身既不证明连续开放，也不证明复刻。');
      default: return t('未核实。');
    }
  }
  function stateLabel(s) {
    if (s === 'ambiguous') return t('歧义');
    if (s === 'outOfRange') return t('跨出候选区间');
    if (s === 'openEnded') return t('长期开放');
    return t('未映射');
  }
  function poolLabel(k) {
    if (k === 'normal') return t('常规活动池');
    if (k === 'ch') return t('角色池');
    if (k === 'lc') return t('光锥池');
    if (k === 'ld') return t('联动池');
    return String(k);
  }
  function typeLabel(gt) {
    if (Number(gt) === 11) return t('角色池');
    if (Number(gt) === 12) return t('光锥池');
    if (Number(gt) === 21) return t('联动角色池');
    if (Number(gt) === 22) return t('联动光锥池');
    return String(gt);
  }

  W.BannerPhasePage = {
    props: { a: Object },
    inject: ['goto'],
    setup() {
      const d = ref(null);
      const loading = ref(true);
      const err = ref('');
      const pools = ref('normal');
      const fPhase = ref('');
      const fVer = ref('');
      const fType = ref('');
      const fPool = ref('');
      const fUp = ref(false);
      const openKey = ref('');
      let timer = null, lastRev = '';

      const load = async () => {
        loading.value = !d.value;
        try {
          const j = await (await fetch('/api/banner-timing?pools=' + pools.value)).json();
          if (j.error) throw new Error(j.error);
          d.value = j; err.value = '';
          // 日历源给了 4.6 角色/光锥的官方英文名（本地索引还没收录），收下它
          if (j.names) W.I18N.registerNames(j.names);
        } catch (e) { err.value = W.I18N.t('读卡池节奏失败：') + e.message; }
        finally { loading.value = false; }
      };

      // 已经打开的页面如何知道「卡池日历被修正了」？—— 轮询一个极轻的修订号接口。
      // 服务端只 stat 几个文件、不读 650KB 的 records.json，所以 45 秒一次也不心疼。
      // ⚠️ 两个修订号都要看：records 变了是「抽数/金数」变了，calendar 变了是「阶段归属」变了；
      //    只盯前者的话，日历修正后页面会一直显示旧结论（需求 §8.4）。
      const tick = async () => {
        try {
          const r = await (await fetch('/api/revisions')).json();
          const sig = r.records + '|' + r.calendar + '|' + r.external;
          if (lastRev && sig !== lastRev) load();
          lastRev = sig;
        } catch (e) { /* 轮询失败下次再试 */ }
      };

      onMounted(() => { load(); tick(); timer = setInterval(tick, 45000); });
      onUnmounted(() => { if (timer) clearInterval(timer); });
      watch(pools, () => load());

      // ── 派生量 ─────────────────────────────────────────────────────────────
      const cov = computed(() => (d.value && d.value.coverage) || {});
      const phases = computed(() => (d.value && d.value.phases) || []);
      const poolRows = computed(() => (d.value && d.value.poolRows) || []);
      const tentativeRows = computed(() => (d.value && d.value.tentativeRows) || []);
      const ongoingRows = computed(() => (d.value && d.value.ongoing) || []);
      const versions = computed(() => [...new Set(poolRows.value.map(r => r.version))].reverse());
      const inc = computed(() => cov.value.included || { pulls: 0, golds: 0 });
      const totPulls = computed(() => inc.value.pulls || 0);
      const totGolds = computed(() => inc.value.golds || 0);
      const allDetail = computed(() => (d.value && d.value.detail) || []);
      const detailIncluded = computed(() => allDetail.value.filter(x => !x.ongoing).length);

      const detail = computed(() => {
        let list = allDetail.value.filter(x => !x.ongoing);
        if (fPhase.value) list = list.filter(x => x.phase === fPhase.value);
        if (fVer.value) list = list.filter(x => x.version === fVer.value);
        if (fType.value) list = list.filter(x => String(x.gt) === fType.value);
        if (fPool.value) list = list.filter(x => x.poolKey === fPool.value);
        if (fUp.value) list = list.filter(x => x.up);
        return list.slice().sort((a, b) => (a.time < b.time ? 1 : -1));   // 默认最新在上
      });
      // 进行中卡池的五星：不进上面的明细表（阶段只是「暂定」），单独挂在各自的池下面
      const ongoingGolds = key => allDetail.value
        .filter(x => x.ongoing && x.poolKey === key)
        .map(x => ({ time: x.time, name: x.name, id: x.id, up: x.up, phase: x.phase }));

      const excluded = computed(() => {
        const e = cov.value.excluded || {};
        const g = k => (e[k] || { pulls: 0 }).pulls;
        return {
          pending: g('ambiguous'),
          unmapped: g('unmapped') + g('outOfRange'),
          boundary: (cov.value.boundary || { pulls: 0 }).pulls,
          backfill: cov.value.undatedBackfillGolds || 0,
        };
      });
      const noData = computed(() => !!d.value && !totPulls.value);
      // 覆盖不足以支撑结论时改说「目前只能分析已核实的 N 抽」（需求 §5A）
      const thinCover = computed(() => {
        const denom = totPulls.value + excluded.value.pending + excluded.value.unmapped
          + excluded.value.boundary;
        return denom > 0 && totPulls.value / denom < 0.9;
      });

      // 卡池行的五星落点：按 2% 一格聚合，同一格的重叠合成一个带数字的点。
      // ⚠️ 落点用 progress（该池自己的 0–100%），**不是**日历上的绝对位置 —— 横条等宽，
      //    不同长度的卡池不能在同一根绝对轴上比（需求 §5C）。
      const marksOf = key => {
        const list = allDetail.value.filter(x => x.poolKey === key && !x.ongoing && x.progress != null);
        const buckets = new Map();
        list.forEach(x => {
          const b = Math.round(x.progress * 50);
          if (!buckets.has(b)) buckets.set(b, []);
          buckets.get(b).push(x);
        });
        return [...buckets.entries()].map(([b, items]) => ({
          p: Math.min(0.985, Math.max(0.015, b / 50)),
          n: items.length,
          up: items.some(x => x.up),
          unc: items.some(x => x.boundaryUncertain || !x.phase),
          tip: items.map(x => x.time.slice(0, 16) + ' · ' + W.I18N.n(x.name)
            + (x.up ? '' : ' · ' + t('歪'))
            + ((x.boundaryUncertain || !x.phase) ? ' · ' + t('边界不确定') : '')).join('\n'),
        }));
      };

      // 逐日抽数柱：高度先在 JS 里算好，模板里不做数学
      const dayBars = row => {
        const list = row.dayHist || [];
        const mx = list.reduce((a, x) => Math.max(a, x.n), 1);
        return list.map(x => ({ d: x.d, n: x.n, h: Math.max(2, Math.round(x.n / mx * 26)) }));
      };

      const barW = v => (v == null ? 0 : Math.max(0, Math.min(100, v)));
      const pct = v => (v == null ? '—' : v + '%');
      const num = v => (v == null ? '—' : String(v));
      const upNames = (o, t2) => (o.featured && o.featured[t2] ? o.featured[t2] : []);
      // 三段抽数之和 vs 本池全部抽数：差额就是落进端点不确定带、没被算进阶段的那几抽
      const phaseSum = r => r.phases.early.pulls + r.phases.mid.pulls + r.phases.late.pulls;

      // CSV 只导出**当前筛选**的数据；文件名不含 UID，内容也不发往任何第三方
      const exportCSV = () => {
        const rows = [['time', 'pool', 'version', 'slot', 'gacha_type', 'phase', 'progress_pct',
          'name', 'up', 'pity_complete', 'pity_full', 'boundary_uncertain', 'assign_src']];
        detail.value.forEach(x => rows.push([
          x.time, x.poolKey, x.version, x.slot, x.gt, x.phase || '',
          x.progress == null ? '' : (x.progress * 100).toFixed(1),
          x.name, x.up ? 'UP' : 'off', x.pityComplete ? 'ok' : 'incomplete', x.pityFull == null ? '' : x.pityFull,
          x.boundaryUncertain ? '1' : '', x.assignSrc,
        ]));
        const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'banner-phase-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      };

      // 「数据来源与时间口径」折叠区：把历史表的口径原话与来源链接摊开，可审计
      // 来源清单只取「键 / 链接 / 类型」三项。
      // ⚠️ 不能直接把 s[k] 整个对象塞进插值 —— Vue 对对象会 JSON.stringify，
      //    于是页面上会出现一大坨带中文 desc 的原始 JSON（en 态直接算漏译，踩过）。
      const srcList = computed(() => {
        const s = (d.value && d.value.sources) || {};
        return Object.keys(s).map(k => ({
          k,
          url: (s[k] && s[k].url) || '',
          type: (s[k] && s[k].type) || '',
        }));
      });
      const convention = computed(() => {
        const c = (d.value && d.value.convention) || {};
        return Object.keys(c).map(k => ({ k, v: c[k] }));
      });

      return {
        d, loading, err, pools, POOL_SETS, fPhase, fVer, fType, fPool, fUp, openKey,
        phases, poolRows, tentativeRows, ongoingRows, versions, detail, detailIncluded, ongoingGolds,
        cov, totPulls, totGolds, excluded, noData, thinCover, marksOf, dayBars,
        barW, pct, num, upNames, phaseSum, exportCSV, load, srcList, convention,
        phaseLabel, phasePartLabel, slotLabel, srcLabel, reasonLabel, stateLabel, poolLabel, typeLabel,
      };
    },
    template: `
    <div class="wrap bp">
      <div class="pagehead">
        <div>
          <h1>{{ t('卡池节奏') }}</h1>
          <div class="sub">{{ t('你在每个卡池开放期的哪个阶段抽到了五星？') }}</div>
        </div>
        <div class="pg-actions">
          <button class="btn" type="button" @click="load">{{ t('重算') }}</button>
          <button class="btn" type="button" @click="goto('help')">{{ t('ⓘ 口径看「解释说明」') }}</button>
        </div>
      </div>

      <div v-if="err" class="note badge-bad">{{ err }}</div>
      <div v-else-if="loading" class="note">{{ t('正在按卡池历史表重算…') }}</div>

      <template v-else-if="d">
        <!-- ── A. 顶部一句话 + 覆盖情况 ─────────────────────────────────── -->
        <div class="card">
          <div class="bp-filters">
            <span class="bp-fl">{{ t('样本') }}</span>
            <button v-for="p in POOL_SETS" :key="p.k" type="button" class="bp-tab"
                    :class="{ on: pools === p.k }" :aria-pressed="pools === p.k"
                    @click="pools = p.k">{{ poolLabel(p.k) }}</button>
            <span class="bp-src" v-if="d.calendar">
              {{ t('卡池日历') }}：{{ d.calendar.source === 'cache' ? t('本地快照') : d.calendar.source }}
              <template v-if="d.calendar.fetchedAtText"> · {{ d.calendar.fetchedAtText }}</template>
              <template v-if="d.calendar.stale"> ({{ t('已过期，离线使用缓存') }})</template>
            </span>
          </div>

          <div v-if="noData" class="bp-empty">
            <p v-html="t('这个筛选下还没有可判定阶段的抽卡。可能是：该池还没有已核实的开放起止时刻，或者抽数都落在了端点不确定带里 —— 下面「待核实」一节会逐条说明。')"></p>
          </div>
          <template v-else>
            <p class="bp-lead" v-html="t('在已核实的 <b>{n}</b> 个真实卡池里，前期出 <b>{g1}</b> 金／抽 <b>{p1}</b> 次，中期出 <b>{g2}</b> 金／抽 <b>{p2}</b> 次，后期出 <b>{g3}</b> 金／抽 <b>{p3}</b> 次。', { n: d.totals.pools, g1: phases[0].golds, p1: phases[0].pulls, g2: phases[1].golds, p2: phases[1].pulls, g3: phases[2].golds, p3: phases[2].pulls })"></p>
            <p class="bp-lead bp-lead-warn" v-if="thinCover" v-html="t('覆盖还不够，所以上面的说法只能当作<b>这已核实的 {p} 抽</b>的描述，不能推广成整个账号的结论。', { p: totPulls })"></p>
            <div class="bp-cov">
              <span class="bp-chip">{{ t('已纳入') }} <b>{{ totPulls }}</b> {{ t('抽') }} / <b>{{ totGolds }}</b> {{ t('金') }}</span>
              <span class="bp-chip">{{ t('卡池名或起止待核实') }} <b>{{ excluded.pending }}</b> {{ t('抽') }}</span>
              <span class="bp-chip" v-if="excluded.unmapped">{{ t('历史表未覆盖／跨期') }} <b>{{ excluded.unmapped }}</b> {{ t('抽') }}</span>
              <span class="bp-chip">{{ t('边界不确定') }} <b>{{ excluded.boundary }}</b> {{ t('抽') }}</span>
              <span class="bp-chip" v-if="excluded.backfill">{{ t('未纳入无时间戳补录') }} <b>{{ excluded.backfill }}</b> {{ t('行') }}</span>
            </div>
            <div class="bp-note" v-html="t('前、中、后是把<b>每期卡池自己的开放时间</b>平均分成三段，<b>不是版本上／下半</b>。金数多也可能只是那段抽得多，<b>不能说明官方概率在某个时段变高</b>。')"></div>
          </template>
        </div>

        <!-- ── B. 总体对照 ─────────────────────────────────────────────── -->
        <div class="card" v-if="!noData">
          <div class="cardhead">
            <div class="ct">{{ t('总体对照') }}</div>
            <div class="cs">{{ t('同一批样本的两种占比：你抽在哪、金出在哪') }}</div>
          </div>
          <div class="bp-cols">
            <div v-for="p in phases" :key="p.key" class="bp-col">
              <div class="bp-col-h">{{ phaseLabel(p.key) }}<span class="bp-col-s">{{ phasePartLabel(p.key) }}</span></div>
              <div class="bp-metric">
                <div class="bp-m-l"><span>{{ t('你的抽数分布') }}</span><b>{{ pct(p.pullShare) }}</b></div>
                <div class="bp-track"><i class="bp-fill" :class="'f-' + p.key" :style="{ width: barW(p.pullShare) + '%' }"></i></div>
                <div class="bp-m-v">{{ p.pulls }} {{ t('抽') }}</div>
              </div>
              <div class="bp-metric">
                <div class="bp-m-l"><span>{{ t('你的五星分布') }}</span><b>{{ pct(p.goldShare) }}</b></div>
                <div class="bp-track"><i class="bp-fill" :class="'g-' + p.key" :style="{ width: barW(p.goldShare) + '%' }"></i></div>
                <div class="bp-m-v">{{ p.golds }} {{ t('金') }}</div>
              </div>
              <div class="bp-m-foot">{{ t('每 100 抽') }} <b>{{ num(p.goldsPer100Pulls) }}</b> {{ t('金') }} · {{ t('涉及 {n} 池', { n: p.pools }) }}</div>
            </div>
          </div>
          <div class="bp-note" v-html="t('合计 <b>{p}</b> 抽 / <b>{g}</b> 金。占比的分母是<b>当前筛选下已确认归期、且阶段可判定</b>的抽数与金数。', { p: totPulls, g: totGolds })"></div>
        </div>

        <!-- ── C. 逐卡池时间轴 ─────────────────────────────────────────── -->
        <div class="card" v-if="poolRows.length">
          <div class="cardhead">
            <div class="ct">{{ t('逐卡池时间轴') }}</div>
            <div class="cs">{{ t('每条按该池自己的 0–100% 进度等分三段；横条等宽，不代表日历上的绝对长度') }}</div>
          </div>
          <div class="bp-rows">
            <div v-for="r in poolRows" :key="r.key" class="bp-row">
              <div class="bp-r-head">
                <div class="bp-r-name">
                  {{ r.version }} {{ slotLabel(r.slot) }}
                  <span class="bp-r-ti bp-cn" v-if="r.title">· {{ r.title }}</span>
                  <span class="bp-badge" :class="r.status === 'provisional' ? 'warn' : ''">{{ r.status === 'provisional' ? t('暂定') : t('已核实') }}</span>
                </div>
                <div class="bp-r-meta">
                  <span class="mono">{{ r.startText }} → {{ r.endText }}</span>
                  <span>· {{ r.days }} {{ t('天') }}</span>
                  <span>· {{ r.pulls }} {{ t('抽') }} / <b>{{ r.golds }}</b> {{ t('金') }}</span>
                  <span class="bp-r-ph">{{ t('抽数') }} {{ r.phases.early.pulls }}/{{ r.phases.mid.pulls }}/{{ r.phases.late.pulls }}</span>
                  <span class="bp-r-ph">{{ t('金') }} {{ r.phases.early.golds }}/{{ r.phases.mid.golds }}/{{ r.phases.late.golds }}</span>
                  <span v-if="r.boundaryPulls" class="bp-r-warn" :title="t('这几抽落在端点不确定带里，阶段判定不出来，所以不进三段')">{{ t('边界不确定') }} {{ r.boundaryPulls }}</span>
                  <a v-if="r.sourceUrl" class="bp-r-src" :href="r.sourceUrl" target="_blank" rel="noopener">{{ t('来源') }}</a>
                  <button type="button" class="bp-r-more" :aria-expanded="openKey === r.key"
                          @click="openKey = (openKey === r.key ? '' : r.key)">{{ openKey === r.key ? t('收起逐日') : t('展开逐日') }}</button>
                </div>
              </div>
              <div class="bp-ups" v-if="upNames(r,'11').length || upNames(r,'12').length">
                <span class="bp-up-t bp-cn" v-if="upNames(r,'11').length">{{ t('角色 UP') }}：{{ upNames(r,'11').join(' · ') }}</span>
                <span class="bp-up-t bp-cn" v-if="upNames(r,'12').length">{{ t('光锥 UP') }}：{{ upNames(r,'12').join(' · ') }}</span>
              </div>
              <div class="bp-bar">
                <i class="bp-seg bp-s1"></i><i class="bp-seg bp-s2"></i><i class="bp-seg bp-s3"></i>
                <button v-for="(m, i) in marksOf(r.key)" :key="i" type="button" class="bp-dot bp-cn"
                        :class="{ off: !m.up, unc: m.unc, l: m.p < 0.12, r: m.p > 0.78 }"
                        :style="{ left: (m.p * 100) + '%' }"
                        :aria-label="m.tip"><span v-if="m.n > 1">{{ m.n }}</span>
                  <span class="bp-tip bp-cn">{{ m.tip }}</span>
                </button>
              </div>
              <div class="bp-axis"><span>{{ t('开场') }}</span><span>{{ t('前 1/3') }}</span><span>{{ t('中 1/3') }}</span><span>{{ t('后 1/3') }}</span><span>{{ t('关闭') }}</span></div>
              <div class="bp-legend">
                <span><i class="bp-di up"></i>{{ t('UP 五星') }}</span>
                <span><i class="bp-di off"></i>{{ t('歪到常驻') }}</span>
                <span><i class="bp-di unc"></i>{{ t('阶段待定（端点不确定）') }}</span>
                <span v-if="phaseSum(r) !== r.pulls">{{ t('三段合计 {a} 抽，本池共 {b} 抽', { a: phaseSum(r), b: r.pulls }) }}</span>
              </div>
              <div class="bp-days" v-if="openKey === r.key">
                <span v-for="(x, i) in dayBars(r)" :key="i" class="bp-day" :title="x.d + ' · ' + x.n + ' ' + t('抽')">
                  <i :style="{ height: x.h + 'px' }"></i><em>{{ x.d.slice(5) }}</em>
                </span>
              </div>
            </div>
          </div>
          <div class="bp-note" v-html="t('横条上的圆点是那一抽落在这期卡池的哪个位置：点一下（或用 Tab 键走到）就能看到具体时间与名字，同位置的重叠会合成一个带数字的点。')"></div>
        </div>

        <!-- ── 暂定：已结束但起止未核实的卡池 ─────────────────────────── -->
        <div class="card" v-if="tentativeRows.length">
          <div class="cardhead">
            <div class="ct">{{ t('暂定卡池（未计入上面的总览）') }}</div>
            <div class="cs">{{ t('起止时刻来自运行时快照、还没人工核实；自己算得出前／中／后，但不进正式结论') }}</div>
          </div>
          <div class="bp-rows">
            <div v-for="r in tentativeRows" :key="r.key" class="bp-row">
              <div class="bp-r-head">
                <div class="bp-r-name">
                  {{ r.version }} {{ slotLabel(r.slot) }}
                  <span class="bp-r-ti bp-cn" v-if="r.title">· {{ r.title }}</span>
                  <span class="bp-badge warn">{{ t('暂定') }}</span>
                </div>
                <div class="bp-r-meta">
                  <span class="mono">{{ r.startText }} → {{ r.endText }}</span>
                  <span>· {{ r.pulls }} {{ t('抽') }} / <b>{{ r.golds }}</b> {{ t('金') }}</span>
                  <span class="bp-r-ph">{{ t('抽数') }} {{ r.phases.early.pulls }}/{{ r.phases.mid.pulls }}/{{ r.phases.late.pulls }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ── 进行中 / 未来卡池 ───────────────────────────────────────── -->
        <div class="card" v-if="ongoingRows.length">
          <div class="cardhead">
            <div class="ct">{{ t('进行中卡池') }}</div>
            <div class="cs">{{ t('按计划结束时间估算，可能调整；不计入上面的正式总览') }}</div>
          </div>
          <div class="bp-rows">
            <div v-for="o in ongoingRows" :key="o.key" class="bp-row">
              <div class="bp-r-head">
                <div class="bp-r-name">
                  {{ o.version }} {{ slotLabel(o.slot) }}
                  <span class="bp-r-ti bp-cn" v-if="o.title">· {{ o.title }}</span>
                  <span class="bp-badge warn">{{ t('进行中') }}</span>
                </div>
                <div class="bp-r-meta">
                  <span class="mono">{{ o.startText }} → {{ o.endText || t('未公布结束时刻') }}</span>
                  <span>· {{ t('已过') }} {{ o.elapsedDays }} {{ t('天') }}</span>
                  <span>· {{ o.pulls }} {{ t('抽') }} / <b>{{ o.golds }}</b> {{ t('金') }}</span>
                </div>
              </div>
              <div class="bp-ups" v-if="upNames(o,'11').length || upNames(o,'12').length">
                <span class="bp-up-t bp-cn" v-if="upNames(o,'11').length">{{ t('角色 UP') }}：{{ upNames(o,'11').join(' · ') }}</span>
                <span class="bp-up-t bp-cn" v-if="upNames(o,'12').length">{{ t('光锥 UP') }}：{{ upNames(o,'12').join(' · ') }}</span>
              </div>
              <template v-if="!o.openEnded">
                <div class="bp-bar">
                  <i class="bp-seg bp-s1"></i><i class="bp-seg bp-s2"></i><i class="bp-seg bp-s3"></i>
                  <i class="bp-now" :style="{ left: (barW((o.progressNow || 0) * 100)) + '%' }"
                     :aria-label="t('此刻')"></i>
                </div>
                <div class="bp-axis"><span>{{ t('开场') }}</span><span>{{ t('前 1/3') }}</span><span>{{ t('中 1/3') }}</span><span>{{ t('后 1/3') }}</span><span>{{ t('关闭') }}</span></div>
                <div class="bp-r-meta">
                  <span>{{ t('此刻进度') }} <b>{{ pct(((o.progressNow || 0) * 100).toFixed(1)) }}</b></span>
                  <span class="bp-r-ph">{{ t('暂定抽数') }} {{ o.phases.early.pulls }}/{{ o.phases.mid.pulls }}/{{ o.phases.late.pulls }}</span>
                  <span class="bp-r-ph">{{ t('暂定金') }} {{ o.phases.early.golds }}/{{ o.phases.mid.golds }}/{{ o.phases.late.golds }}</span>
                  <span class="bp-r-warn">{{ t('按计划结束时间估算，可能调整') }}</span>
                </div>
              </template>
              <div class="bp-note" v-else>{{ t('官方公告只写了「长期开放」、没有结束时刻，所以不生成前／中／后结论，也不进正式总览。') }}</div>
              <div class="bp-legend" v-if="ongoingGolds(o.key).length">
                <span v-for="(x, i) in ongoingGolds(o.key)" :key="i">
                  <i class="bp-di" :class="x.up ? 'up' : 'off'"></i>{{ x.time.slice(0, 16) }} {{ n(x.name) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- ── D. 五星明细 ─────────────────────────────────────────────── -->
        <div class="card">
          <div class="cardhead">
            <div class="ct">{{ t('五星明细') }}</div>
            <div class="cs">{{ t('每一颗五星都能指回它所在的那一期卡池') }}</div>
          </div>
          <div class="bp-filters">
            <span class="bp-fl">{{ t('筛选') }}</span>
            <select class="bp-sel" v-model="fVer" :aria-label="t('版本')">
              <option value="">{{ t('全部版本') }}</option>
              <option v-for="v in versions" :key="v" :value="v">{{ v }}</option>
            </select>
            <select class="bp-sel" v-model="fType" :aria-label="t('池类型')">
              <option value="">{{ t('全部池类型') }}</option>
              <option v-for="y in d.perPoolType" :key="y.gt" :value="String(y.gt)">{{ typeLabel(y.gt) }}</option>
            </select>
            <select class="bp-sel" v-model="fPhase" :aria-label="t('阶段')">
              <option value="">{{ t('全部阶段') }}</option>
              <option value="early">{{ t('前期') }}</option>
              <option value="mid">{{ t('中期') }}</option>
              <option value="late">{{ t('后期') }}</option>
            </select>
            <select class="bp-sel" v-model="fPool" :aria-label="t('卡池')">
              <option value="">{{ t('全部卡池') }}</option>
              <option v-for="r in poolRows" :key="r.key" :value="r.key">{{ r.key }}（{{ r.pulls }} {{ t('抽') }}）</option>
            </select>
            <label class="bp-ck"><input type="checkbox" v-model="fUp"> {{ t('只看 UP') }}</label>
            <button type="button" class="btn" @click="exportCSV">{{ t('导出当前筛选 CSV') }}</button>
            <span class="bp-cnt">{{ detail.length }} / {{ detailIncluded }}</span>
          </div>
          <div class="bp-tblwrap">
            <table class="tb bp-tbl">
              <thead><tr>
                <th>{{ t('出金时间') }}</th><th>{{ t('卡池') }}</th><th>{{ t('五星') }}</th><th>UP</th>
                <th class="hn">{{ t('池进度') }}</th><th>{{ t('阶段') }}</th><th>{{ t('保底') }}</th><th>{{ t('识别依据') }}</th>
              </tr></thead>
              <tbody>
                <tr v-for="(x, i) in detail" :key="i">
                  <td class="mono">{{ x.time.slice(0, 16) }}</td>
                  <td>{{ x.version }} {{ slotLabel(x.slot) }}<span class="bp-r-ti bp-cn" v-if="x.poolTitle"> · {{ x.poolTitle }}</span></td>
                  <td><b>{{ n(x.name) }}</b></td>
                  <td><span class="pill" :class="{ g: x.up }">{{ x.up ? 'UP' : t('歪') }}</span></td>
                  <td class="num">{{ x.progress == null ? '—' : (x.progress * 100).toFixed(1) + '%' }}</td>
                  <td><span class="pill" :class="'pp-' + x.phase">{{ x.phase ? phaseLabel(x.phase) : t('待定') }}</span></td>
                  <td>
                    <span v-if="x.pityComplete">{{ t('完整') }}</span>
                    <span v-else class="badge-bad"
                          :title="x.pityFull == null ? t('接口窗口之前的那几抽拿不到，保底抽数被截断') : t('完整抽数来自截图补录（data/account.json）')">{{ x.pityFull == null ? t('跨窗口不完整') : t('{n} 抽（补录）', { n: x.pityFull }) }}</span>
                  </td>
                  <td class="bp-sub">{{ srcLabel(x.assignSrc) }}<template v-if="x.boundaryUncertain"> · {{ t('边界不确定') }}</template></td>
                </tr>
                <tr v-if="!detail.length"><td colspan="8" class="bp-none">{{ t('当前筛选下没有五星记录') }}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="bp-note" v-html="t('「池进度」是这一抽出金时，该池已经走过了它自己开放期的百分之几。<b>保底抽数可能由更早的、甚至另一期的垫抽累积而来</b>，所以不把整条保底周期搬到出金所在的那一段。')"></div>
        </div>

        <!-- ── 待核实 ─────────────────────────────────────────────────── -->
        <div class="card" v-if="d.pending.length || d.knownGaps.length">
          <div class="cardhead">
            <div class="ct">{{ t('待核实') }}</div>
            <div class="cs">{{ t('这些抽卡没有进入上面的结论 —— 说得出原因，才敢说得出结论') }}</div>
          </div>
          <div class="bp-tblwrap">
            <table class="tb bp-tbl">
              <thead><tr>
                <th>{{ t('池类型') }}</th><th>gacha_id</th><th>{{ t('首末抽') }}</th><th class="hn">{{ t('抽数') }}</th><th class="hn">{{ t('金') }}</th>
                <th>{{ t('候选卡池') }}</th><th>{{ t('状态') }}</th><th>{{ t('原因') }}</th>
              </tr></thead>
              <tbody>
                <tr v-for="(p, i) in d.pending" :key="'p' + i">
                  <td>{{ typeLabel(p.gt) }}</td>
                  <td class="mono">{{ p.gid }}</td>
                  <td class="mono">{{ p.first }} → {{ p.last }}</td>
                  <td class="num">{{ p.n }}</td>
                  <td class="num">{{ p.golds }}</td>
                  <td class="mono">{{ (p.candidates || []).join(' / ') || '—' }}</td>
                  <td><span class="pill y">{{ stateLabel(p.state) }}</span></td>
                  <td class="bp-sub">{{ reasonLabel(p.code) }}</td>
                </tr>
                <tr v-for="(g, i) in d.knownGaps" :key="'g' + i">
                  <td>{{ typeLabel(g.poolType) }}</td>
                  <td class="mono">{{ g.gachaId }}</td>
                  <td class="mono">{{ g.first ? (g.first + ' → ' + g.last) : '—' }}</td>
                  <td class="num">{{ g.n }}</td>
                  <td class="num">{{ g.golds }}</td>
                  <td class="mono">—</td>
                  <td><span class="pill y">{{ t('已知缺口') }}</span></td>
                  <td class="bp-sub">{{ reasonLabel(g.code) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="bp-note" v-html="t('口径：阶段是按<b>该池自己的开放区间</b>三等分判定的；同期并行的多个池若起止完全相同，阶段仍可确定，只是<b>池名未确认</b>。任何拿不准的一律列在这里，<b>不会按数组顺序或「最像的名字」静默分配</b>。')"></div>
        </div>

        <!-- ── E. 数据来源与时间口径 ──────────────────────────────────── -->
        <div class="card">
          <details class="bp-det">
            <summary>{{ t('数据来源与时间口径') }}</summary>
            <div class="bp-srcbox">
              <div class="bp-srcrow"><span class="bp-srck">{{ t('时区') }}</span><span>{{ d.tz }} · {{ t('页面上的时刻都是服务器时间') }}</span></div>
              <div class="bp-srcrow"><span class="bp-srck">{{ t('历史表版本') }}</span><span class="mono">{{ d.revision }}</span></div>
              <div class="bp-srcrow"><span class="bp-srck">{{ t('重算时刻') }}</span><span class="mono">{{ d.generatedAt.slice(0, 19).replace('T', ' ') }}Z</span></div>
              <div class="bp-srcrow" v-for="c in convention" :key="c.k">
                <span class="bp-srck bp-cn">{{ c.k }}</span><span class="bp-cn">{{ c.v }}</span>
              </div>
              <div class="bp-srcrow" v-for="s in srcList" :key="s.k">
                <span class="bp-srck">{{ s.k }}</span>
                <a :href="s.url" target="_blank" rel="noopener" class="mono">{{ s.url }}</a>
                <span class="bp-styp mono">{{ s.type }}</span>
              </div>
              <div class="bp-srcrow" v-for="(w, i) in d.warnings" :key="'w' + i">
                <span class="bp-srck">{{ t('提示') }}</span><span class="bp-cn">{{ w }}</span>
              </div>
            </div>
          </details>
        </div>

        <div class="slim-hint">
          <span v-html="t('卡池起止时刻整理自公开可核查的资料（每行都带来源链接），随代码发布在 <code>core/banner-history.json</code>，<b>不含任何账号数据</b>。')"></span>
          <span v-html="t('本地记录按 <b>+08:00 服务器时间</b> 解释；本页<b>不改写</b>任何原始抽卡记录，也不改动「抽卡分析」页的既有看板。')"></span>
          <span class="rd-more" @click="goto('help')">{{ t('口径与已知限制 →') }}</span>
        </div>
      </template>

      <div v-else class="note badge-bad">{{ t('读卡池节奏失败') }}</div>
    </div>`,
  };
})();
