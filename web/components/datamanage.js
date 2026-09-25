// ─────────────────────────────────────────────────────────────────────────────
// 「数据管理」页 —— 抓取抽卡链接 / 看数据现状 / 各卡池时间边界 / 数据补填 / 自检
//
// 2026-09-16（需求 1.2）：
//   · 需求 4 —— 删掉「数据校验：与工坊对账」卡片（连带抽卡分析页的「对账」徽章，一起下线）
//   · 需求 5 —— 「星穹工坊「抽卡总结」基数」改名为「数据补填」
// 2026-09-17（需求 1.3-1）：快照时间与起点都精确到「分秒」
// 2026-09-25（多语言）：界面文案走 t()；setup 内用 W.I18N.t（混入方法在 setup 里拿不到 this）。
//   ⚠️ 抓取过程中的**服务端日志**保持中文（操作日志，非界面文案）。
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const W = window.W = window.W || {};
  const { ref, computed, onMounted, onUnmounted } = Vue;

  const pad = n => String(n).padStart(2, '0');
  // 本地时间字符串（与本平台其它地方的时间格式一致，都是不带时区的本地时间）
  const fmtNow = () => {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' '
      + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  };
  // 只到「日」的写法也接受（引擎会按该日结束处理），校验用
  const SNAP_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;

  W.DataManage = {
    props: { a: Object },
    emits: ['refetch', 'refresh-icon'],
    setup(props, { emit }) {
      const link = ref('');
      const st = ref(null);
      const job = ref(null);
      const busy = ref(false);
      const err = ref('');
      // 保存成功提示存**参数对象**而不是拼好的字符串 —— 切语言时模板里重算即可跟着变
      const savedMsg = ref(null);      // { pulls, gold, at } | null
      // ⚠️ 快照时间是**精确到秒的当下时刻**，并且每秒跟随当前时间走 —— 用户要求「自动取到 now 到分秒且实时同步」。
      //    手动改过就停下来（`snapTouched`），否则正在输入的值会被秒针冲掉。
      const form = ref({ pulls: '', gold: '', snapAt: fmtNow(), autoFetchIcons: true });
      const snapTouched = ref(false);
      let timer = null;      // 抓取 job 轮询
      let tick = null;       // 快照时间秒级跟随
      let inited = false;

      const loadStatus = async () => {
        try {
          st.value = await (await fetch('/api/status')).json();
          const m = st.value.meta || {};
          const w = m.wsBase || {};
          if (!inited) {
            inited = true;
            form.value = {
              pulls: w.pulls != null ? w.pulls : '',
              gold: w.gold != null ? w.gold : '',
              // 默认 = 现在（秒级）；用户不动它就一直跟着当前时间走
              snapAt: fmtNow(),
              autoFetchIcons: m.autoFetchIcons !== false,
            };
          }
        } catch (e) { err.value = W.I18N.t('读状态失败：') + e.message; }
      };

      // 手动编辑 → 停止跟随；点「跟随当前时间」→ 恢复跟随并立刻同步一次
      const onSnapInput = () => { snapTouched.value = true; };
      const followNow = () => { snapTouched.value = false; form.value.snapAt = fmtNow(); };

      const poll = async (id) => {
        try {
          const j = await (await fetch('/api/fetch/status?id=' + id)).json();
          job.value = j;
          if (!j.running) {
            clearInterval(timer); timer = null; busy.value = false;
            await loadStatus();
            if (!j.error) { emit('refetch'); }
          }
        } catch (e) { /* 轮询失败就下次再试 */ }
      };

      const startFetch = async () => {
        err.value = ''; busy.value = true; job.value = null;
        try {
          const r = await fetch('/api/fetch', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link: link.value.trim() }),
          });
          const j = await r.json();
          if (j.error) { err.value = j.error; busy.value = false; return; }
          timer = setInterval(() => poll(j.jobId), 900);
          poll(j.jobId);
        } catch (e) { err.value = W.I18N.t('启动抓取失败：') + e.message; busy.value = false; }
      };

      const saveMeta = async () => {
        savedMsg.value = null; err.value = '';
        const p = Number(form.value.pulls), g = Number(form.value.gold);
        if (!Number.isFinite(p) || p <= 0) { err.value = W.I18N.t('「总抽数」要填一个正整数'); return; }
        if (!Number.isFinite(g) || g < 0) { err.value = W.I18N.t('「五星数」要填一个非负整数'); return; }
        // 快照时刻直接取框内值：正常路径是秒级时刻（跟随当前时间来的），
        // 也有可能是用户手填的完整时刻，或只填到「日」（引擎按该日结束处理）。
        const at = String(form.value.snapAt || '').trim().replace('T', ' ') || fmtNow();
        if (!SNAP_RE.test(at)) { err.value = W.I18N.t('「快照时间」格式应为 2026-09-16 或 2026-09-16 09:07:12'); return; }
        const prev = (st.value && st.value.meta && st.value.meta.fillLog) || [];
        const entry = { at: fmtNow(), pulls: p, gold: g, snapAt: at };
        try {
          const r = await fetch('/api/meta', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              wsBase: { pulls: p, gold: g, at },
              autoFetchIcons: !!form.value.autoFetchIcons,
              fillLog: prev.concat([entry]).slice(-50),
            }),
          });
          const j = await r.json();
          if (j.error) { err.value = W.I18N.t('保存失败：') + j.error; return; }
          await loadStatus();
          savedMsg.value = { p, g, at };
          emit('refetch');
          setTimeout(() => { savedMsg.value = null; }, 6000);
        } catch (e) { err.value = W.I18N.t('保存失败：') + e.message; }
      };

      const refreshIcons = async () => {
        busy.value = true; err.value = '';
        try { await fetch('/api/icons/refresh', { method: 'POST' }); await loadStatus(); emit('refetch'); }
        catch (e) { err.value = W.I18N.t('刷新图标失败：') + e.message; }
        finally { busy.value = false; }
      };

      // 子组件（外部统计补录）里改完数据，同样要把整页状态和分析结果都重取一遍
      const emitRefetch = () => { loadStatus(); emit('refetch'); };

      onMounted(() => {
        loadStatus();
        // 快照时间每秒跟随当前时间（用户手动改过就停，见 snapTouched）
        tick = setInterval(() => { if (!snapTouched.value) form.value.snapAt = fmtNow(); }, 1000);
      });
      onUnmounted(() => { if (timer) clearInterval(timer); if (tick) clearInterval(tick); });

      // 来源表格**先在 setup 里算好字符串**再交给模板 —— 模板里直接 s.at.slice() 的话，
      // 只要有一条历史数据缺 at 字段（早期手工导入的就是），整页就渲染不出来。
      const srcTable = computed(() => ((st.value && st.value.sources) || []).slice().reverse().map(s => ({
        when: s.at ? String(s.at).slice(0, 19).replace('T', ' ') : W.I18N.t('(早期导入)'),
        endpoint: s.endpoint || '—',
        incoming: s.incoming != null ? s.incoming : 0,
        added: s.added != null ? s.added : 0,
      })));
      const ic = computed(() => (st.value && st.value.icons) || { avatar: {}, light_cone: {}, characters: 0, light_cones: 0 });
      // 起点与「当前生效的基准」都是只读展示，值从 /api/status 来（不在前端自算）。
      // ⚠️ 起点**精确到秒**（用户要求）：`st.from` 是引擎给的本地仓最早那条记录的完整时刻。
      const earliest = computed(() => (st.value && st.value.from ? String(st.value.from).slice(0, 19) : '—'));
      const active = computed(() => {
        const w = (st.value && st.value.meta && st.value.meta.wsBase) || {};
        return { pulls: w.pulls, gold: w.gold, at: w.at || '' };
      });
      const fillRows = computed(() => (((st.value && st.value.meta && st.value.meta.fillLog) || []).slice().reverse()).map(x => ({
        when: x.at ? String(x.at).slice(0, 19) : '—',
        pulls: x.pulls != null ? x.pulls : '—',
        gold: x.gold != null ? x.gold : '—',
        // 快照时刻精确到秒；早期只存了「日」的旧记录照原样显示
        snap: x.snapAt ? String(x.snapAt).slice(0, 19) : '—',
      })));
      // 提示随状态变三种：正在跟随 / 手动填了秒级时刻 / 手动只填到「日」（读 t() → 切语言自动跟着变）
      const snapHint = computed(() => {
        if (!snapTouched.value) return W.I18N.t('正在实时跟随当前时间（精确到秒）');
        const v = String(form.value.snapAt || '').trim();
        if (v.length <= 10) return W.I18N.t('已手动填到「日」→ 按该日结束 23:59:59 算增量分界');
        return W.I18N.t('已手动填写，不再跟随当前时间');
      });
      return {
        link, st, job, busy, err, savedMsg, form, snapTouched, onSnapInput, followNow,
        startFetch, saveMeta, refreshIcons, loadStatus, emitRefetch,
        srcTable, ic, earliest, active, fillRows, snapHint,
      };
    },
    template: `
    <div class="wrap dm">
      <div class="pagehead">
        <div>
          <h1>{{ t('数据管理') }}</h1>
          <div class="sub" v-html="t('粘贴抽卡链接 → 抓取 6 类跃迁池 → 按 id 去重合并进本地仓（<b>取并集，不覆盖</b>）→ 自动补齐缺失的角色头像与光锥图标<br>下方依次是：数据现状 · 各卡池时间边界 · <b>数据补填</b> · <b>外部统计补录</b> · 自检断言')"></div>
        </div>
        <div class="pg-actions"><span class="pill">{{ st ? t('{n} 条记录', { n: st.records }) : t('读取中…') }}</span></div>
      </div>

      <!-- ── 1. 抓取 ────────────────────────────────────────────────────── -->
      <div class="card">
        <h3>{{ t('① 抓取新的抽卡记录') }}</h3>
        <div class="ch">
          <span v-html="t('在游戏里打开「跃迁记录」→ 点右上角的分享/导出拿到链接（形如 <code>...api/getGachaLog?authkey=...</code>），整条粘贴到下面。链接里的 <code>end_id</code> / <code>page</code> 会被自动忽略，不需要自己删。<br>')"></span>
          <span v-html="t('<b>第一次导入</b>会建立本地仓；之后每次导入都是<b>校验 + 累计</b>：按 id 去重，<b>已有记录原样不动</b>，只把新出现的追加进去。<br>')"></span>
          <span v-html="t('抓取会<b>同时请求两个端点</b>：普通池（角色/光锥/群星/新手）走 <code>getGachaLog</code>，联动池走 <code>getLdGachaLog</code> —— 只抓一个会静默漏掉整个联动池。')"></span>
        </div>
        <textarea v-model="link" spellcheck="false" placeholder="https://public-operation-hkrpg.mihoyo.com/common/hkrpg_gacha_record/api/getGachaLog?authkey=...&amp;game_biz=hkrpg_cn&amp;..."></textarea>
        <div class="row">
          <button class="btn pri" :disabled="busy || !link.trim()" @click="startFetch">{{ busy ? t('抓取中…') : t('开始抓取并合并') }}</button>
          <button class="btn" :disabled="busy" @click="refreshIcons">{{ t('只刷新图标与索引') }}</button>
          <span v-if="err" class="badge-bad" style="font-size:12.5px">{{ err }}</span>
        </div>
        <div v-if="job" class="prog">
          <div v-for="(l, i) in job.logs" :key="i"><span class="t">{{ l.t }}</span><span :class="{ er: l.phase === 'error', okc: l.phase === 'done' }">{{ l.msg }}</span></div>
          <div v-if="job.running" style="color:var(--tx3)">{{ t('…进行中（抓取是逐页翻的，记录多时约 1~3 分钟，请不要关窗口）') }}</div>
        </div>
        <div v-if="job && job.result" class="note2">
          <span v-html="t('<b>本次结果：</b>抓到 <b>{total}</b> 条中的新增 <b>{added}</b> 条（重复 {dup} 条）；本地仓合计 <b>{total2}</b> 条 [{from} → {to}]；图标新增 <b>{ic}</b> 个、失败 {icf} 个。', { total: job.result.merged.total, added: job.result.merged.added, dup: job.result.merged.dup, total2: job.result.merged.total, from: job.result.merged.from.slice(0,10), to: job.result.merged.to.slice(0,10), ic: job.result.icons.downloaded, icf: job.result.icons.failed.length })"></span>
        </div>
        <table class="tb" v-if="job && job.result">
          <thead><tr><th>{{ t('卡池') }}</th><th>{{ t('端点') }}</th><th class="hn">{{ t('记录数') }}</th><th>{{ t('区间') }}</th></tr></thead>
          <tbody>
            <tr v-for="r in job.result.fetch" :key="r.type">
              <td>{{ t(r.name) }} <code>{{ r.type }}</code></td>
              <td><span class="pill" :class="r.endpoint === 'getLdGachaLog' ? 'y' : ''">{{ r.endpoint }}</span></td>
              <td class="num">{{ r.n }}</td>
              <td class="mono">{{ r.n ? r.from.slice(0,16) + ' → ' + r.to.slice(0,16) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ── 2. 现状 ────────────────────────────────────────────────────── -->
      <div class="card">
        <h3>{{ t('② 本地数据现状') }}</h3>
        <div class="ch" v-html="t('官方接口只保留约 1 年，而且是<b>滑动窗口</b>（新的一批进来、最老的一批被挤掉），所以每抓一次都要合并进本地仓，别覆盖。')"></div>
        <div class="kv" v-if="st">
          <div class="it"><div class="k">UID</div><div class="v">{{ st.uid || '—' }}</div></div>
          <div class="it"><div class="k">{{ t('本地记录') }}</div><div class="v">{{ t('{n} 条', { n: st.records }) }}</div></div>
          <div class="it"><div class="k">{{ t('数据区间') }}</div><div class="v" style="font-size:13px">{{ st.from ? st.from.slice(0,10) + ' → ' + st.to.slice(0,10) : '—' }}</div></div>
          <div class="it"><div class="k">{{ t('角色图标') }}</div><div class="v">{{ ic.avatar.valid }} <small>{{ t('/ {n} 个角色', { n: ic.characters }) }}</small></div></div>
          <div class="it"><div class="k">{{ t('光锥图标') }}</div><div class="v">{{ ic.light_cone.valid }} <small>{{ t('/ {n} 张光锥', { n: ic.light_cones }) }}</small></div></div>
          <div class="it"><div class="k">Node</div><div class="v" style="font-size:13px">{{ st.node }}</div></div>
        </div>
        <table class="tb" style="margin-top:12px" v-if="srcTable.length">
          <thead><tr><th>{{ t('最近几次抓取') }}</th><th>{{ t('端点') }}</th><th class="hn">{{ t('拉到') }}</th><th class="hn">{{ t('新增') }}</th></tr></thead>
          <tbody>
            <tr v-for="(s, i) in srcTable" :key="i">
              <td class="mono">{{ s.when }}</td>
              <td>{{ s.endpoint }}</td>
              <td class="num">{{ s.incoming }}</td>
              <td class="num">{{ s.added }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ── 3. 各卡池时间边界 ──────────────────────────────────────────── -->
      <div class="card">
        <h3>{{ t('③ 各卡池时间边界') }}</h3>
        <div class="ch" v-html="t('用来看<b>接口能回溯到多早</b>（滑动窗口的左端）、每个池当前垫了多少抽。')"></div>
        <w-pool-bounds :a="a" bare></w-pool-bounds>
      </div>

      <!-- ── 4. 数据补填 ────────────────────────────────────────────────── -->
      <div class="card">
        <h3>{{ t('④ 数据补填') }}</h3>
        <div class="ch">
          <span v-html="t('接口保留期之外的历史已经无法恢复，所以<b>「总抽数 / 五星数」这两个总量用人工补填</b>——重新看一次总量（任意来源）就把数字填进来。<b>其余口径全自动衍生</b>，不要再手工维护别的字段。')"></span>
        </div>
        <div class="grid2">
          <div><label class="fl">{{ t('总抽数') }}</label><input type="number" v-model="form.pulls">
            <div class="fh">{{ t('截至快照时的累计抽数') }}</div></div>
          <div><label class="fl">{{ t('五星数') }}</label><input type="number" v-model="form.gold">
            <div class="fh">{{ t('同一时点的五星总数') }}</div></div>
          <div><label class="fl">{{ t('快照时间') }}</label><input type="text" v-model="form.snapAt" @input="onSnapInput" placeholder="2026-09-16 09:07:12">
            <div class="fh">{{ snapHint }}<button v-if="snapTouched" class="lnk" type="button" @click="followNow">{{ t('↻ 跟随当前时间') }}</button></div></div>
          <div><label class="fl">{{ t('近期总抽数起点') }}</label>
            <div class="robox">{{ earliest }}</div>
            <div class="fh" v-html="t('自动取本地仓最早记录，<b>不可修改</b>')"></div></div>
        </div>
        <div class="row">
          <button class="btn pri" :disabled="busy" @click="saveMeta">{{ t('保存并更新') }}</button>
          <label style="font-size:12.5px;color:var(--tx2);display:flex;gap:6px;align-items:center">
            <input type="checkbox" v-model="form.autoFetchIcons"> {{ t('抓取后自动补齐缺失图标') }}
          </label>
          <span v-if="savedMsg" class="badge-ok" style="font-size:12.5px" v-html="t('已保存并更新：总抽数 {p} 抽 / 五星 {g} 金，快照时刻 {at}', savedMsg)"></span>
        </div>
        <div class="note2">
          <span v-html="t('<b>当前生效：</b>总抽数 <b>{p}</b> / 五星 <b>{g}</b>，快照时刻 <b>{at}</b> —— 增量 = <b>晚于该时刻</b>的记录（按精确时刻切，否则当天已抽的记录会被重复计入）。<br>', { p: active.pulls, g: active.gold, at: active.at })"></span>
          <span v-html="t('<b>为什么总量要人工补填：</b>接口只保留约 180 天 ~ 1 年，更早的记录服务器已经删了，本机再怎么解析也只能回溯到 <b>{earliest}</b>。', { earliest })"></span>
        </div>
        <h3 style="margin-top:16px">{{ t('修改记录') }}</h3>
        <div class="ch">{{ t('每次点「保存并更新」都会把这次输入的字段原样留档，最新在上。') }}</div>
        <table class="tb">
          <thead><tr><th>{{ t('保存时间') }}</th><th class="hn">{{ t('总抽数') }}</th><th class="hn">{{ t('五星数') }}</th><th>{{ t('快照时刻') }}</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in fillRows" :key="i">
              <td class="mono">{{ r.when }}</td>
              <td class="num">{{ r.pulls }}</td>
              <td class="num">{{ r.gold }}</td>
              <td class="mono">{{ r.snap }}</td>
            </tr>
            <tr v-if="!fillRows.length"><td colspan="4" style="color:var(--tx3)">{{ t('还没有补填记录 —— 上面的「保存并更新」按一次就会出现在这里。') }}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- ── 5. 外部统计补录（放「修改记录」下面 —— 用户要求）──────────────── -->
      <div class="card">
        <h3>{{ t('⑤ 外部统计补录（上传截图）') }}</h3>
        <w-shot-import :a="a" @refetch="emitRefetch"></w-shot-import>
      </div>

      <div class="card">
        <h3>{{ t('⑥ 关于「存不存在漏掉」的自检') }}</h3>
        <div class="ch">
          <span v-html="t('抓完之后，本平台会在服务端跑一遍<b>构建时断言</b>，任何一条不过就直接报错、不给你看错数据：')"></span>
        </div>
        <div class="note2">
          <span v-html="t('· <b>专属光锥命途一致性</b>：64 组「角色 ↔ 专属光锥」的命途必须两两相同；<br>')"></span>
          <span v-html="t('· <b>常驻池逐条对账</b>：群星跃迁窗口内的金必须与截图补录的抽数<b>逐条相等</b>；<br>')"></span>
          <span v-html="t('· <b>池内序号越界兜底</b>：任何卡池的「池内第几抽」不得超过该池总抽数（防 gacha_id 归并出错）；<br>')"></span>
          <span v-html="t('· <b>逐池合计恒等</b>：角色活动 ＋ 光锥活动 ＋ 常驻 ＋ 新手 ＋ 联动 必须等于总抽数；<br>')"></span>
          <span v-html="t('· <b>图标有效性</b>：每个图标都校验 <b>PNG 魔数 + 字节数下限</b>，不是「文件在就算有」。')"></span>
        </div>
      </div>
    </div>`,
  };
})();
