// ─────────────────────────────────────────────────────────────────────────────
// 崩铁抽卡分析平台 · 英文词条表（en-US）
//
// 设计要点（与 web/i18n.js 的分工）：
//   · i18n.js 只管**机制**（t / n / L / guaEn + localStorage + <html data-lang>），
//     本文件只管**数据**（纯 key → value 表，零逻辑、零依赖、零构建）；
//   · key = 界面里的**中文原文**（msgid 式），所以 zh 模式根本不查表 → 天然零漏译；
//   · en 模式查不到就回退中文，宁可露一句中文，也不露空串或 key；
//   · {x} 占位符与 <b>/<code>/<span> 等标记**原样保留**，替换值由 t() 负责转义。
//
// 表在代码里显式分两段（两个对象，最后合并）：
//   · RUNTIME —— **静态扫不出来**的运行时 key：导航 / 主题 / 命途 / 卡池名 /
//     八经卦 / 数据来源 / 起卦法名等，由引擎或常量表在运行时给出，源码里不存在
//     任何 t('…') 字面量。改 core/ 或 app.js 的常量表时要同步这一段。
//   · LITERAL —— 从界面源码里扫出来的字面量 key（tools/check-i18n.js 逐条核对）。
//
// ⚠️ 占卜**内容层**（卦辞 / 爻辞 / 白话释义 / 黄历宜忌 / 择时打分依据 / 十二时辰）
//    刻意不进这张表：周易原文与黄历术语在英文里没有对等概念，保留原文才是这一页的特色。
//    本表只翻**结构性 UI**（按钮 / 表头 / 段落标题 / 口径与免责清单 / 平台自有算法说明）。
//
// 校验：node tools/check-i18n.js（CI 里跑）—— 查漏词条 / 占位符 / 译文残留中文；
//       运行时残留由无头验收兜底。这份表**直接手改即可**，改完跑一次校验。
// ─────────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';
  root.W = root.W || {};

  const RUNTIME = {
    '分析':
      'Analysis',
    '数据':
      'Data',
    '帮助':
      'Help',
    '后续开发':
      'Coming soon',
    '抽卡分析':
      'Warp Analysis',
    '角色管理':
      'Characters',
    '八卦占卜':
      'Divination',
    '抓取与数据管理':
      'Fetch & Data',
    '解释说明':
      'Guide',
    '卡池日历':
      'Banner Calendar',
    '配队与培养建议':
      'Teams & Builds',
    '设置':
      'Settings',
    '炫彩':
      'Vivid',
    '明亮':
      'Light',
    '暗黑':
      'Dark',
    '玻璃':
      'Glass',
    '取自 logo 的深空星云配色：电光蓝 → 紫 → 青，配车头暖光':
      'Deep-space nebula palette taken from the logo: electric blue → violet → cyan, with a warm headlight glow',
    '原来的浅色配色':
      'The original light palette',
    '中性冷灰暗色，长时间看不刺眼':
      'Neutral cool-grey dark; easy on the eyes over long sessions',
    '流体玻璃：半透明面板 + 背景彩色光团':
      'Liquid glass: translucent panels over soft colour blooms',
    '群星跃迁':
      'Stellar Warp',
    '始发跃迁':
      'Departure Warp',
    '角色活动跃迁':
      'Character Event Warp',
    '光锥活动跃迁':
      'Light Cone Event Warp',
    '角色联动跃迁':
      'Character Collaboration Warp',
    '光锥联动跃迁':
      'Light Cone Collaboration Warp',
    '常驻跃迁':
      'Stellar Warp',
    '新手跃迁':
      'Departure Warp',
    '常驻':
      'Standard',
    '新手':
      'Beginner',
    '角色':
      'Character',
    '光锥':
      'Light Cone',
    '联动角色':
      'Collab Char',
    '联动光锥':
      'Collab LC',
    '联动池':
      'Collab banner',
    '毁灭':
      'Destruction',
    '巡猎':
      'The Hunt',
    '智识':
      'Erudition',
    '同谐':
      'Harmony',
    '存护':
      'Preservation',
    '虚无':
      'Nihility',
    '丰饶':
      'Abundance',
    '记忆':
      'Remembrance',
    '欢愉':
      'Elation',
    '乾':
      'Qian (Heaven)',
    '兑':
      'Dui (Lake)',
    '离':
      'Li (Fire)',
    '震':
      'Zhen (Thunder)',
    '巽':
      'Xun (Wind)',
    '坎':
      'Kan (Water)',
    '艮':
      'Gen (Mountain)',
    '坤':
      'Kun (Earth)',
    '星魂':
      'Eidolon',
    '叠影':
      'Superimposition',
    '专属':
      'Signature',
    '限定':
      'Limited',
    '接口窗口':
      'API window',
    '截图补录':
      'Screenshot backfill',
    '外部统计':
      'External stats',
    '接口+截图':
      'API + screenshot',
    '接口窗口 + 截图补录':
      'API window + Screenshot backfill',
    '接口窗口 + 外部统计':
      'API window + External stats',
    '截图补录 + 外部统计':
      'Screenshot backfill + External stats',
    '接口窗口 + 截图补录 + 外部统计':
      'API window + Screenshot backfill + External stats',
    '出金':
      'Won UP',
    '歪常驻':
      'Lost 50/50',
    '未出金':
      'No 5★',
    '出金线':
      '5★ line',
    'UP 线':
      'UP line',
    '任何 5★':
      'any 5★',
    '当期限定':
      'featured limited',
    '三枚铜钱法':
      'Three-coin method',
    '大衍揲蓍法':
      'Yarrow-stalk method',
    '三枚铜钱掷六次':
      'three coins thrown six times',
    '四十九策·十八变':
      'forty-nine stalks, eighteen changes',
    '静心默念所求，再点「开始摇卦」':
      'Settle your question in mind, then tap “Cast the hexagram”',
    '吉':
      'Auspicious',
    '中':
      'Neutral',
    '凶':
      'Ominous',
    '大吉':
      'Great Fortune',
    '吉签':
      'Favourable',
    '平签':
      'Middling',
    '凶签':
      'Ominous',
    // 占卜「吉凶档位」与「几成把握」两族：由 core/zeri.js（日家 / 时家档位）、
    // core/huangli.js（出金吉凶）、core/divination.js（卦象档位 LEVEL + GOAL 表）
    // 在运行时给出，源码里没有任何 t('…') 字面量 —— 所以归 RUNTIME，别挪回 LITERAL。
    '上吉':
      'Excellent',
    '小吉':
      'Fair',
    '小凶':
      'Poor',
    '平':
      'Neutral',
    '不宜':
      'Unsuitable',
    '大吉 · 六成把握即出手':
      'Great Fortune · act at 60% confidence',
    '吉 · 七成把握':
      'Auspicious · 70% confidence',
    '小吉 · 八成把握':
      'Fair · 80% confidence',
    '平 · 九成把握':
      'Neutral · 90% confidence',
    '小凶 · 九成五把握':
      'Poor · 95% confidence',
    '凶 · 只等硬保底':
      'Ominous · wait for hard pity',
    // 卡池期次与页签短名：由 core/banner.js（上半 / 下半）与 core/analyze.js 的 BAN_META
    // （角色跃迁 / 光锥跃迁）在运行时给出 —— 同样是源码里扫不到的字面量，归 RUNTIME。
    '上半':
      'first half',
    '下半':
      'second half',
    '角色跃迁':
      'Character',
    '光锥跃迁':
      'Light Cone',
  };

  const LITERAL = {
    ' —— 到期当天只开到凌晨，之后的时辰没有池子，<b>因此不作推荐</b>（只排到 {to}）':
      ' — on the closing day the banner only runs until the early morning, so the remaining hours have no banner and <b>are left unranked</b> (ranked up to {to} only)',
    ' · 动':
      ' · moving',
    ' · 未获得':
      ' · Not owned',
    ' · 与对应爻辞':
      ' · with the matching line texts',
    '，虚线 = 拿到当期限定':
      '; dashed = featured limited',
    '；竖线 = 主推的第 {at} 抽':
      '; vertical line = recommended warp #{at}',
    '…进行中（抓取是逐页翻的，记录多时约 1~3 分钟，请不要关窗口）':
      '…in progress (history is paged through one page at a time; with a long history this takes about 1–3 minutes — please keep this window open)',
    '· <b>常驻池逐条对账</b>：群星跃迁窗口内的金必须与截图补录的抽数<b>逐条相等</b>；<br>':
      '· <b>Standard-pool reconciliation, entry by entry</b>: every 5★ inside the Stellar Warp window must <b>match</b> the screenshot-backfilled warp count, one for one;<br>',
    '· <b>池内序号越界兜底</b>：任何卡池的「池内第几抽」不得超过该池总抽数（防 gacha_id 归并出错）；<br>':
      '· <b>In-banner index bounds check</b>: the “warp # within this banner” of any banner may never exceed that banner’s total warp count (guards against gacha_id merge errors);<br>',
    '· <b>图标有效性</b>：每个图标都校验 <b>PNG 魔数 + 字节数下限</b>，不是「文件在就算有」。':
      '· <b>Icon validity</b>: every icon is checked for a <b>PNG magic number plus a minimum byte size</b> — a file merely being present does not count as valid.',
    '· <b>逐池合计恒等</b>：角色活动 ＋ 光锥活动 ＋ 常驻 ＋ 新手 ＋ 联动 必须等于总抽数；<br>':
      '· <b>Per-banner totals must add up</b>: Character Event + Light Cone Event + Standard + Beginner + Collab must equal the grand total;<br>',
    '· <b>专属光锥命途一致性</b>：64 组「角色 ↔ 专属光锥」的命途必须两两相同；<br>':
      '· <b>Signature light cone Path consistency</b>: in all 64 “character ↔ signature light cone” pairs the two Paths must match;<br>',
    '· 当前用的是内置表（联网取不到）':
      '· Showing the built-in table (online source unreachable)',
    '· 缓存已过期，显示的是上次结果':
      '· Cache has expired — showing the last fetched result',
    '· 开池时刻已用本地抽卡记录校准':
      '· Banner open time calibrated against local warp history',
    '（本池官方未单独公示 UP 率，按同类池口径估）':
      ' (the official rate-up for this banner is not published separately; estimated from comparable banners)',
    '（动画里的卦象仅作演示，解读需要服务启动）':
      ' (the hexagram in the animation is a demo only; the reading needs the local service running)',
    '（官方未公示软保底，按基础概率 + 硬保底建模）':
      ' (soft pity is not officially published; modelled from the base rate plus hard pity)',
    '（还需 {n}）':
      ' ({n} more to go)',
    '（跨期累计）':
      ' (accumulated across banners)',
    '（其余功能不受影响）':
      ' (everything else is unaffected)',
    '（已垫 {n}）':
      ' ({n} into pity)',
    '{full} · <code>gacha_type={gt}</code> · 共 <b>{c}</b> 个卡池，其中 <b>{inf}</b> 个的当期 UP 可由数据自身推出':
      '{full} · <code>gacha_type={gt}</code> · <b>{c}</b> banners in total, <b>{inf}</b> of which have a featured UP that can be derived from the data itself',
    '{g} → 余 {r}':
      '{g} → {r} left',
    '{m} 抽出金（数学期望）· 半数人 {p} 抽内出金':
      '{m} warps per 5★ (expected value) · half of all players hit a 5★ within {p} warps',
    '{n} 抽 —— 小保底最坏要「歪一次 + 再吃满一个保底」，会跨到下一期':
      '{n} warps — from a 50/50 the worst case is “lose once, then ride a full pity down”, which spills into the next banner',
    '{n} 个':
      '{n}',
    '{n} 个角色 · 右侧是该角色的专属光锥 · 数据来自「接口窗口 + 截图补录」两个来源':
      '{n} characters · the right-hand side shows each character’s signature light cone · merged from two sources: API window + screenshot backfill',
    '{n} 天':
      '{n} days',
    '{n} 条':
      '{n} records',
    '{n} 条 · 上传过 {m} 张图':
      '{n} records · {m} images uploaded',
    '{n} 条记录':
      '{n} records',
    '{n} 行 · 识别结果仅供参考，请逐行核对':
      '{n} rows · recognition is advisory only — check every row',
    '{n} 张 · 按命途分组 · 右下角为叠影等级':
      '{n} light cones · grouped by Path · bottom-right shows the Superimposition rank',
    '{name}　叠影 {s}（共 {cc} 张 · {src}）':
      '{name}　Superimposition {s} ({cc} copies · {src})',
    '{r}命':
      'E{r}',
    '「来源」三色：<span class="tg ok">出金</span> 抽到过当期 UP · <span class="tg bad">歪常驻</span> 出金但一次 UP 都没抽到 · <span class="tg dim">未出金</span> 窗口内无金。':
      'Three source colours: <span class="tg ok">Won UP</span> pulled the featured UP · <span class="tg bad">Lost 50/50</span> pulled a 5★ but never the featured one · <span class="tg dim">No 5★</span> no 5★ inside the window.',
    '「已垫抽数」＝距该池最近一次出金之后又抽了多少（<code>/90</code> <code>/80</code> <code>/50</code> 为保底上限）；':
      '“Warps into pity” = how many warps have been made since the most recent 5★ in that banner (<code>/90</code> <code>/80</code> <code>/50</code> are the hard-pity caps);',
    '/ {n} 个角色':
      '/ {n} characters',
    '/ {n} 张光锥':
      '/ {n} light cones',
    '↻ 跟随当前时间':
      '↻ Follows the current time',
    '⇅ 数据管理':
      '⇅ Data',
    '＋ 手动加一行':
      '+ Add a row manually',
    '<b>「池内第几抽」</b>：只数本池（gacha_id <b>{gid}</b>）自己的 {n} 条记录，这一抽在本池排第几，第 1 抽就是本池第一条。<br>':
      '<b>“Warp # within this banner”</b>: counts only the {n} records belonging to this banner (gacha_id <b>{gid}</b>) — where this warp sits inside the banner, with warp 1 being that banner’s first record.<br>',
    '<b>「真实保底」</b>：距上一个五星实际抽了多少，<b>跨同类型的卡池累计</b>（角色池与光锥池各自一套，互不相通）。':
      '<b>“True pity”</b>: how many warps were actually made since the previous 5★, <b>accumulated across banners of the same type</b> (the character pool and the light cone pool each keep their own counter and never share).',
    '<b><code>gacha_id</code> 只表示「哪一池」</b>，所以本表<b>按它归并</b>（一个卡池一行）；「时间区间」是该池<b>首末抽卡时间</b>，<b>不是在架时长</b>。':
      '<b><code>gacha_id</code> only means “which banner”</b>, so this table <b>merges by it</b> (one row per banner); the “time range” is that banner’s <b>first and last warp time</b>, <b>not how long it was live</b>.',
    '<b>⚠️ 有 {n} 处「外部统计」与「抽卡记录推算」不一致</b>，已按外部统计生效：':
      '<b>⚠️ {n} places where “external stats” disagree with “the warp-history estimate”</b> — external stats are in effect:',
    '<b>把截图拖进来</b>，或点这里选择文件（可多选）':
      '<b>Drop screenshots here</b>, or click to choose files (multiple allowed)',
    '<b>本次结果：</b>抓到 <b>{total}</b> 条中的新增 <b>{added}</b> 条（重复 {dup} 条）；本地仓合计 <b>{total2}</b> 条 [{from} → {to}]；图标新增 <b>{ic}</b> 个、失败 {icf} 个。':
      '<b>This run:</b> of <b>{total}</b> fetched records, <b>{added}</b> were new ({dup} duplicates); the local store now holds <b>{total2}</b> records [{from} → {to}]; <b>{ic}</b> icons added, {icf} failed.',
    '<b>成卦</b>：六爻<b>自下而上</b>排列，第一次掷的落在初爻。老阳/老阴为动爻，动爻阴阳反转得变卦。':
      '<b>Building the hexagram</b>: the six lines are stacked <b>bottom-up</b>, so the first throw becomes the bottom line. Old Yang / Old Yin are moving lines, and flipping them yields the transformed hexagram.',
    '<b>抽数为什么是单点</b>：全部来自官方公示概率模型，与卦象无关。卦象只决定<b>「要几成把握才出手」</b>（大吉六成 → 凶等硬保底），抽数是解出的<b>最小达标那一抽</b>。软保底区一抽能跳好几个百分点，所以实际把握会略高于目标值 —— 这是离散分布的性质，不是算宽了。':
      '<b>Why a single warp number</b>: it comes entirely from the officially published probability model and has nothing to do with the hexagram. The hexagram only sets <b>how much confidence counts as enough</b> (Great Fortune 60% → Ominous waits for hard pity); the number is the <b>smallest warp count that meets it</b>. In the soft-pity zone one warp can jump several percentage points, so the actual confidence lands slightly above the target — a property of a discrete distribution, not padding.',
    '<b>出金线 vs UP 线</b>：出金 = 任何 5★；UP 线 = 当期限定，且把「先歪一次、再吃大保底」整段算进去。小保底时 UP 线可能<b>超出本期</b>（最坏要歪一次再吃满一个保底）；这时页面直接摊开本期天花板，而不是给一个根本做不到的数字。':
      '<b>5★ line vs UP line</b>: the 5★ line means any 5★; the UP line means the featured limited one, with the whole “lose once, then ride the guarantee down” path included. From a 50/50 the UP line can <b>fall outside this banner</b> (worst case: lose once and then hit hard pity); when that happens the page lays the banner’s ceiling out plainly instead of quoting a number you cannot reach.',
    '<b>当前生效：</b>总抽数 <b>{p}</b> / 五星 <b>{g}</b>，快照时刻 <b>{at}</b> —— 增量 = <b>晚于该时刻</b>的记录（按精确时刻切，否则当天已抽的记录会被重复计入）。<br>':
      '<b>Currently in effect:</b> <b>{p}</b> total warps / <b>{g}</b> 5★, snapshot taken at <b>{at}</b> — the delta is records <b>later than that instant</b> (cut by exact timestamp, otherwise warps made earlier that same day would be counted twice).<br>',
    '<b>第一次导入</b>会建立本地仓；之后每次导入都是<b>校验 + 累计</b>：按 id 去重，<b>已有记录原样不动</b>，只把新出现的追加进去。<br>':
      '<b>The first import</b> creates the local store; every later import is <b>validate + accumulate</b>: deduplicate by id, <b>leave existing records untouched</b>, and append only what is new.<br>',
    '<b>概率从哪来</b>：官方只公示「基础概率 + 综合概率 + 硬保底」，没公示软保底曲线。本平台用的曲线（角色 74 抽起每抽 +6%、光锥 66 抽起每抽 +7%）<b>回算综合概率 1.605% / 1.872%</b>，与官方公示的 1.600% / 1.870% 吻合。整条累计曲线已用 <b>20 万次蒙特卡洛</b>对账，解析值与模拟值差在 0.2 个百分点以内。<b>卦不会凭空多给你运气</b>，它只决定你要求几成把握才出手。':
      '<b>Where the probabilities come from</b>: the official site publishes only “base rate + consolidated rate + hard pity”, never the soft-pity curve. The curve used here (character: +6% per warp from warp 74; light cone: +7% from warp 66) <b>back-computes to a 1.605% / 1.872% consolidated rate</b>, matching the published 1.600% / 1.870%. The whole cumulative curve has been reconciled against a <b>200,000-run Monte Carlo</b>, with analytical and simulated values within 0.2 percentage points of each other. <b>A hexagram does not conjure luck</b> — it only decides how much confidence you demand before spending.',
    '<b>吉凶</b>：字面词表打分，不是卦义阐释；命中的词全部列出，可自行复核。档位阈值按 12000 次抽样的分位数标定，不是手拍。':
      '<b>Auspicious / Ominous</b>: scored literally against a fixed word list, not an interpretation of the hexagram’s meaning; every matched word is listed so you can check it yourself. Tier thresholds are calibrated from the score distribution over 12,000 samples, not eyeballed.',
    '<b>解释的四个层次</b>：彖传（释卦辞）· 大象传（释卦象）· 小象传（逐爻释爻辞）· 吉/中/凶标签（384 爻全有）—— 前三者取自古籍与开源数据集，可查证；<b>「白话」一栏是本平台撰述</b>，不是原文，用来自查意思有没有读反。':
      '<b>Four layers of commentary</b>: the Tuan Zhuan (on the Judgement) · the Da Xiang Zhuan (on the Image) · the Xiao Xiang Zhuan (line by line) · Auspicious / Neutral / Ominous tags (present for all 384 lines). The first three come from classical texts and open datasets and can be verified; <b>the “Plain reading” column is written by this project</b>, not the original text, and exists so you can check you have not read a line backwards.',
    '<b>卡池日期</b>：当期卡池的起止与 UP 名单来自第三方日历（api.ennead.cc），<b>不是官方接口</b>。数据源给的开始时刻偏 +7 小时，已用本地抽卡记录的「首抽时间」校准到开池当日中午；如与游戏内公告不符，<b>以游戏内为准</b>。这是本页唯一的联网请求，其余功能全部离线可用。':
      '<b>Banner dates</b>: the start, end and featured list of the current banner come from a third-party calendar (api.ennead.cc) and are <b>not an official endpoint</b>. The source’s start time runs 7 hours late, and it has been calibrated to noon on the day the banner opened using the first warp in your local history; if it disagrees with the in-game notice, <b>the game wins</b>. This is the page’s only network request — everything else works offline.',
    '<b>两法的关系</b>：两法的 P(该爻为动爻) 都是 1/4，所以 <b>动爻数与变卦的分布完全相同</b>（0~6 个动爻的概率都与 B(6, ¼) 吻合，实测偏差小于 0.5 个百分点）。差别只在「动的那一爻是阳变阴还是阴变阳」—— 大衍法 3:1 偏阳变阴，铜钱法 1:1。<b>换起卦法不会让卦象变多或变少</b>。':
      '<b>How the two methods relate</b>: both give P(a given line moves) = 1/4, so <b>the distribution of moving-line counts and of transformed hexagrams is identical</b> (the probability of 0–6 moving lines matches B(6, ¼), with measured deviation under 0.5 percentage points). The only difference is whether a moving line is Yang turning Yin or the reverse — the yarrow method favours Yang→Yin 3:1, the coin method 1:1. <b>Switching methods never adds or removes hexagrams</b>.',
    '<b>起卦法二 · 大衍揲蓍</b>：四十九策，分二·挂一·揲四·归奇，三变一爻、十八变一卦。四象概率 老阳 3/16、少阴 7/16、少阳 5/16、老阴 1/16（归奇只出 13/17/21/25，余策 36/32/28/24 除以 4）。⚠️ 网上不少页面把少阳与少阴写成 7/16 和 5/16，那是错的 —— 本平台这组数用 60 万次抽样钉死，实测 18.71% / 43.79% / 31.24% / 6.26%。':
      '<b>Method two · Yarrow stalks</b>: forty-nine stalks; split in two, set one aside, count off in fours, remove the remainders; three changes make one line and eighteen make a hexagram. The four images come out at Old Yang 3/16, Young Yin 7/16, Young Yang 5/16 and Old Yin 1/16 (the remainders are only ever 13/17/21/25, and the stalk counts 36/32/28/24 divide by four). ⚠️ Plenty of pages online swap Young Yang and Young Yin to 7/16 and 5/16 — that is wrong; this project pinned the numbers with 600,000 samples, measuring 18.71% / 43.79% / 31.24% / 6.26%.',
    '<b>起卦法一 · 三枚铜钱</b>：<b>背为阳</b>（一背二字「单·少阳」／二背一字「拆·少阴」／三背「重·老阳」／三字「交·老阴」）。概率由三枚公平硬币决定：少阳 3/8、少阴 3/8、老阳 1/8、老阴 1/8 —— 不是四种各 1/4。':
      '<b>Method one · Three coins</b>: <b>the reverse side counts as Yang</b> (one reverse two obverse = “Single, Young Yang”; two reverse one obverse = “Split, Young Yin”; three reverse = “Heavy, Old Yang”; three obverse = “Crossing, Old Yin”). The probabilities follow from three fair coins: Young Yang 3/8, Young Yin 3/8, Old Yang 1/8, Old Yin 1/8 — not 1/4 each.',
    '<b>取用</b>：朱熹《易学启蒙 · 考变占》按动爻数 0~6 决定读本卦卦辞、动爻爻辞还是变卦卦辞，以上爻/下爻为主也有定法。':
      '<b>Which text to read</b>: Zhu Xi’s Yixue Qimeng (Kaobian Zhan) fixes, by the number of moving lines from 0 to 6, whether you read the primary hexagram’s Judgement, the moving lines’ texts, or the transformed hexagram’s Judgement, and equally prescribes when the upper or lower line takes precedence.',
    '<b>剩余期内择日</b>：⚠️ 黄历里没有「宜抽卡」，本页把它映射到最接近的「求财 / 开市 / 纳财 / 交易」—— <b>这个映射是本平台定的，不是古法</b>。日家打分只用《协纪辨方书》体系里的黄黑道、建除十二神、二十八宿、宜忌与吉神凶煞，档位阈值按分位数标定。择吉是传统口径，<b>与抽卡概率无关</b>。':
      '<b>Picking a day inside the remaining window</b>: ⚠️ the almanac has no “suitable for warping” category, so this page maps it onto the closest ones (seeking wealth / opening a market / receiving income / trade) — <b>that mapping is this project’s own, not a classical rule</b>. Day scoring uses only the Yellow–Black Path, the Twelve Day Officers, the Twenty-Eight Mansions, the do/don’t lists and the auspicious and inauspicious deities of the Xieji Bianfang Shu; tier thresholds are set from score quantiles. Day selection is a traditional framework and <b>has no bearing on warp probabilities</b>.',
    '<b>为什么给单点，不给范围</b>：范围（比如「1~79 抽」）对决策没用 —— 它把「第 1 抽就出」和「第 79 抽才出」并列成同一件事。这里的做法是：卦象先定「几成把握算够」（大吉六成 → 凶等硬保底），再由官方概率模型解出<b>最小的那一抽</b>，并把这一抽的<b>真实把握</b>一起给出。':
      '<b>Why a single point and not a range</b>: a range (say “1–79 warps”) is useless for a decision — it files “came home on warp 1” and “came home on warp 79” as the same event. Instead the hexagram first sets <b>how much confidence counts as enough</b> (Great Fortune 60% → Ominous waits for hard pity), then the official probability model solves for <b>the smallest warp count that meets it</b>, and that warp’s <b>true confidence</b> is shown alongside.',
    '<b>为什么总量要人工补填：</b>接口只保留约 180 天 ~ 1 年，更早的记录服务器已经删了，本机再怎么解析也只能回溯到 <b>{earliest}</b>。':
      '<b>Why the totals are entered by hand:</b> the API only keeps roughly 180 days to a year, and earlier records are already gone from the server, so no amount of local parsing can reach back further than <b>{earliest}</b>.',
    '<b>星魂 / 叠影</b>是「接口窗口 ＋ 工坊截图补录 ＋ 外部统计」<b>三源合计</b>（星魂 = 总金数 − 1、上限 6；叠影 = 总张数、上限 5）。':
      '<b>Eidolons / Superimposition</b> are the <b>three-source total</b> of “API window + workshop screenshot backfill + external stats” (Eidolons = total copies − 1, capped at 6; Superimposition = total copies, capped at 5).',
    '<b>虚线框</b>＝ 来自工坊截图补录（接口拿不到）':
      '<b>Dashed border</b> = comes from workshop screenshot backfill (the API cannot provide it)',
    '<b>引文</b>：卦辞与爻辞取自三个互相独立的开源数据集，归一化爻序与繁简后<b>多数票定稿</b>：卦辞 61/64、爻辞 362/384 三源逐字一致；有异文的条目在上方标注了各源原文。':
      '<b>Source texts</b>: the Judgements and line texts are taken from three mutually independent open datasets; after normalising line order and traditional/simplified forms, <b>the majority vote is final</b>: 61 of 64 Judgements and 362 of 384 line texts agree verbatim across all three sources. Entries with textual variants list each source’s reading above.',
    '<b>准确性</b>：概率部分（「第 N 抽」、UP 线、稳拿抽数）已用 <b>20 万次蒙特卡洛</b>对账，解析值与模拟值差在 0.2 个百分点以内，「稳拿」抽数经 2 万次模拟无一失手。⚠️ 但这些精确性<b>全部来自游戏的概率系统，不是占卜的预测力</b> —— 卦只提供「几成把握算够」这把尺子。':
      '<b>Accuracy</b>: the probability side (“warp N”, the UP line, the guaranteed count) has been reconciled against a <b>200,000-run Monte Carlo</b>, with analytical and simulated values within 0.2 percentage points of each other, and the “guaranteed” count never failed across 20,000 simulations. ⚠️ But that precision <b>comes entirely from the game’s probability system, not from any predictive power of divination</b> — the hexagram only supplies the yardstick for “how much confidence is enough”.',
    '<b>data/external.json 里有 {n} 行解析不出来</b>（已忽略，不影响其它条目）：':
      '<b>{n} rows in data/external.json could not be parsed</b> (ignored; the other entries are unaffected):',
    '<br><b>注：</b>第 <b>{ip}</b> 抽的「{name}」是本池在接口窗口内的<b>第一金</b>，它的保底是从<b>保留期之前</b>续起来的，所以这里显示的是<b>窗口内能解析到的 {p} 抽</b>，不含接口已经查不到的那段垫抽。':
      '<br><b>Note:</b> “{name}” on warp <b>{ip}</b> is the banner’s <b>first 5★</b> inside the API window, and its pity was carried over from <b>before</b> the retention window — so what is shown is the <b>{p} warps that can still be parsed inside the window</b>, excluding the earlier pity the API can no longer see.',
    '＝ <b>叠影等级</b>（抽到该光锥 N 张）':
      '= <b>Superimposition rank</b> (the light cone was pulled N times)',
    '＝ <b>星魂等级</b>（抽到该角色 N+1 次）':
      '= <b>Eidolon rank</b> (the character was pulled N+1 times)',
    '＝ 该角色的专属光锥本账号还没抽到':
      '= this account has not pulled that character’s signature light cone yet',
    '○ 老阳':
      '○ Old Yang',
    '○ 老阳 · ✕ 老阴 = 动爻':
      '○ Old Yang · ✕ Old Yin = moving line',
    '⚠️ 本页是<b>娱乐与自我参照</b>用途，不构成任何消费建议。抽卡结果由游戏的概率系统决定，与占卜无关。保底状态需要你自己确认 —— 记录里没有「上一个金是不是当期」的可靠字段，硬猜就是循环论证。':
      '⚠️ This page is for <b>entertainment and self-reference</b> only and is not spending advice of any kind. Pull outcomes are decided by the game’s probability system and have nothing to do with divination. You must confirm your own pity state — the records contain no reliable field for “was the last 5★ the featured one”, and guessing at it would be circular reasoning.',
    '✕ 老阴':
      '✕ Old Yin',
    '✦ 角色管理':
      '✦ Characters',
    '① 抓取新的抽卡记录':
      '① Fetch new warp records',
    '10抽':
      '10 warps',
    '② 本地数据现状':
      '② Local data at a glance',
    '③ 各卡池时间边界':
      '③ Per-banner time bounds',
    '④ 数据补填':
      '④ Backfill totals',
    '⑤ 外部统计补录（上传截图）':
      '⑤ External stats (upload screenshots)',
    '⑥ 关于「存不存在漏掉」的自检':
      '⑥ Self-checks for “did anything get missed”',
    '69抽':
      '69 warps',
    '74抽':
      '74 warps',
    '76抽':
      '76 warps',
    '78抽':
      '78 warps',
    '81抽':
      '81 warps',
    '9 章说明书：每个数字的来源与口径':
      'A 9-chapter guide: where every number comes from and what it means',
    '按十二时辰自然序排列 · 描边为此刻所在时辰':
      'Ordered by the natural sequence of the twelve double-hours · the outline marks the current one',
    '把握':
      'confidence',
    '白话':
      'Plain reading',
    '保存并更新':
      'Save & update',
    '保存到角色管理（{n} 条）':
      'Save to Characters ({n} rows)',
    '保存会<b>整体覆盖</b>上一次的外部统计（这是一份「此刻状态」的快照，不是追加）':
      'Saving <b>replaces the previous external stats wholesale</b> (this is a snapshot of the current state, not an append)',
    '保存时间':
      'Saved at',
    '保底状态':
      'Pity state',
    '背 = 阳':
      'Reverse = Yang',
    '本池出金的两个数字恰好一致。':
      'Both numbers for 5★ in this banner happen to agree.',
    '本池窗口内共抽了 <b>{n}</b> 抽，<b>没有五星</b>。':
      '<b>{n}</b> warps inside this banner’s window, <b>no 5★</b>.',
    '本池第 {n} 抽':
      'warp {n} of this banner',
    '本池第几抽':
      'warp # of this banner',
    '本池有 <b>{c}</b> 个金两者不同 —— 如第 <b>{ip}</b> 抽出的「{name}」真实保底 <b>{p}</b> 抽，说明中间有 {diff} 抽抽在了同时上架的另一个池上。':
      'This banner has <b>{c}</b> 5★ where the two numbers differ — e.g. “{name}” on warp <b>{ip}</b> shows a true pity of <b>{p}</b>, meaning {diff} warps went to another banner that was live at the same time.',
    '本地工作台':
      'Local workbench',
    '本地还没有抽卡记录':
      'No warp records locally yet',
    '本地记录':
      'Local records',
    '本卦':
      'Primary hexagram',
    '本卦定当下 · 动爻是破局点 · 变卦看趋势':
      'The primary hexagram fixes the present · moving lines are the turning points · the transformed hexagram shows the trend',
    '崩铁抽卡分析':
      'Honkai: Star Rail Warp Analysis',
    '变白话':
      'Transformed, plain reading',
    '变卦':
      'Transformed hexagram',
    '变卦：':
      'Transformed hexagram: ',
    '变爻':
      'Transformed line',
    '标「另一端点」的两行走 <code>getLdGachaLog</code>，<b>跨度长是因为按 <code>gacha_type</code> 合并了历史上多期</b>，不代表连开一年。':
      'The two rows marked “other endpoint” go through <code>getLdGachaLog</code>; <b>their long spans come from merging several past runs by <code>gacha_type</code></b> and do not mean a year-long banner.',
    '不一致不等于谁错了：抽卡推算依赖「截图补录」那段手抄数据，缺一笔就会偏低；以外部统计为准最稳。':
      'Disagreement does not mean anyone is wrong: the warp-history estimate leans on the hand-entered screenshot backfill, and one missing entry skews it low; treating external stats as authoritative is the safest call.',
    '参考':
      'Reference',
    '常驻池已与接口逐条校验通过（{p} 抽）。':
      'The standard pool checks out against the API line by line ({p} warps).',
    '超出本期！本期最多 {p}':
      'Beyond this banner! The ceiling here is {p}',
    '池':
      ' banner',
    '池内抽数':
      'warps in banner',
    '池内第 {n} 抽 · {name}':
      'warp {n} in banner · {name}',
    '池内第几抽':
      'warp # in banner',
    '抽 / 金':
      ' warps / 5★',
    '抽到的物品':
      'Item pulled',
    '抽取时间':
      'Warp time',
    '抽数':
      'Warps',
    '出金率':
      '5★ rate',
    '出金线 · 建议出手点':
      '5★ line · suggested spend point',
    '除官方抽卡接口之外，你在<b>别处看到的总量/持有状态</b>也能录进来：游戏内「角色 / 光锥」列表、星穹工坊统计页、米游社等。上传截图 → 平台用<b>本机图标库</b>做模板匹配（<b>全程离线，图片不出本机</b>）→ 你在下面确认表里核对/改正 → 保存。<br>':
      'Beyond the official warp API, you can also record the <b>totals and ownership you see elsewhere</b>: the in-game character / light cone lists, the Star Rail Station stats page, HoYoLAB, and so on. Upload a screenshot → the platform template-matches against its <b>local icon library</b> (<b>fully offline; images never leave this machine</b>) → you check and correct the rows below → save.<br>',
    '除下方一处外，界面与算法全部离线':
      'Everything here runs offline apart from one item below',
    '处理中…':
      'Working…',
    '此刻':
      'Now',
    '次吉':
      'Fair',
    '大保底':
      'Guaranteed',
    '大保底 · 出金必定是当期':
      'Guaranteed · any 5★ is the featured one',
    '带「<b>识别</b>」角标的行是自动填的，<b>分数</b>越接近 1 越可信（<b>≥0.86 较稳</b>、0.72~0.86 要留意、<b><0.72 建议手动改</b>）。角色填<b>星魂</b>（0~6），光锥填<b>叠影</b>（1~5，只抽到 1 张就填 1）。改完点最下面的「保存到角色管理」。':
      'Rows tagged <b>recognised</b> were filled in automatically; the closer the <b>score</b> is to 1 the more reliable it is (<b>≥0.86 solid</b>, 0.72–0.86 worth a look, <b>&lt;0.72 edit it by hand</b>). Characters take <b>Eidolons</b> (0–6); light cones take <b>Superimposition</b> (1–5 — a single copy is 1). When you are done, click “Save to Characters” at the bottom.',
    '待开发':
      'Planned',
    '当期 UP':
      'Featured UP',
    '当期卡池':
      'Current banner',
    '当期卡池日期自动获取 · 两套正统起卦法（三枚铜钱 / 大衍揲蓍）· 按朱熹《易学启蒙》变占取用 · 卦辞爻辞带注疏与白话 · 剩余期内逐日择吉 · <b>卦只定「要几成把握」，抽数由官方概率模型解出单点</b> —— 不给「1~79」这种用不上的范围':
      'Banner dates fetched automatically · two orthodox casting methods (three coins / yarrow stalks) · readings taken per Zhu Xi’s Yixue Qimeng · Judgements and line texts with commentary and plain readings · auspicious days for the rest of the banner · <b>the hexagram only sets “how much confidence counts as enough”; the warp count is solved from the official probability model as a single point</b> — never a useless “1–79” range',
    '当期卡池识别':
      'Current banner detection',
    '当前保底状态：决定「出金时是当期」的概率':
      'Current pity state: sets the chance that a 5★ is the featured one',
    '当前没有展开的卡池明细':
      'No banner detail is expanded right now',
    '档位阈值':
      'Tier thresholds',
    '得分':
      'Score',
    '得分 {tt} = 主判据 {m} + 本卦卦辞 {b} + 变卦卦辞 {bi}':
      'Score {tt} = primary rule {m} + primary Judgement {b} + transformed Judgement {bi}',
    '第 {no} 卦 · {how}':
      'Hexagram {no} · {how}',
    '第 {no} 卦 · 上{shang} 下{xia}':
      'Hexagram {no} · upper {shang}, lower {xia}',
    '第 74 抽出货，且是当期 UP（实底 = 接口窗口）':
      'Hit on warp 74 and it was the featured UP (true pity = API window)',
    '第 81 抽出货，但歪到常驻':
      'Hit on warp 81 but lost the 50/50 to a standard 5★',
    '点击任意一行展开出金明细 · 可同时展开多个 · 开太多时用右上角「一键收折」':
      'Click any row to expand its 5★ detail · several can be open at once · if it gets crowded use “Collapse all” in the top-right',
    '点任意一行展开<b>出金明细</b>（池内第几抽 · 真实保底 · 吉凶）。':
      'Click any row to expand the <b>5★ detail</b> (warp # in banner · true pity · auspiciousness).',
    '点这里维护补填的总量基准（在「数据管理」页）':
      'Click here to maintain the backfilled totals baseline (on the “Data” page)',
    '叠{s}':
      'S{s}',
    '叠影 {s}':
      'Superimposition {s}',
    '叠影 {s}（共 {c} 张 · {src}）':
      'Superimposition {s} ({c} copies · {src})',
    '动爻 {m} 反转而得':
      'obtained by flipping moving line(s) {m}',
    '动爻共 <b>{n}</b> 个{list}；取用规则出自朱熹《易学启蒙 · 考变占》，0~6 个动爻各有定法，不由本平台自创。':
      '<b>{n}</b> moving line(s){list}; the rule for which text to read comes from Zhu Xi’s Yixue Qimeng (Kaobian Zhan) — each count from 0 to 6 has its own fixed rule, none of them invented here.',
    '读分析结果失败：':
      'Failed to read the analysis result: ',
    '读取中…':
      'Loading…',
    '读入图片…':
      'Reading image…',
    '端点':
      'Endpoint',
    '断卦':
      'Reading the hexagram',
    '分':
      'Pts',
    '分数':
      'Score',
    '该抽单抽概率':
      'P(5★ on this warp)',
    '各卡池时间边界':
      'Per-banner time bounds',
    '各卡池时间边界 / 数据补填 / 抓取与同步':
      'Per-banner time bounds / backfill totals / fetch & sync',
    '更多注疏':
      'More commentary',
    '构成':
      'Composition',
    '卦定把握度 · 数学定抽数 · 给单点不给范围':
      'The hexagram sets the confidence · the maths sets the warp count · a single point, never a range',
    '卦定宜进宜守 · 时辰另算':
      'The hexagram says advance or hold · the hour is scored separately',
    '卦象':
      'Hexagram',
    '卦象档位 <b>{g}</b>（目标 {p}）。实际落点会略高于目标 —— 软保底区一抽能跳好几个百分点，停不到整数上。':
      'Hexagram tier <b>{g}</b> (target {p}). The actual result lands slightly above the target — in the soft-pity zone a single warp can jump several percentage points, so it cannot stop on a round number.',
    '卦象字面吉凶 · 时辰倾向':
      'Literal auspiciousness of the hexagram · hour tendency',
    '官方接口只保留约 1 年，而且是<b>滑动窗口</b>（新的一批进来、最老的一批被挤掉），所以每抓一次都要合并进本地仓，别覆盖。':
      'The official API keeps only about a year, as a <b>sliding window</b> (a new batch arrives and the oldest is pushed out), so every fetch must be merged into the local store — never overwritten.',
    '光锥图标':
      'Light cone icon',
    '光锥右下角 叠 N':
      'Light cone, bottom-right: “S N”',
    '还没有补填记录 —— 上面的「保存并更新」按一次就会出现在这里。':
      'No backfill records yet — press “Save & update” above once and it will show up here.',
    '还没有待确认的行 —— 上传截图，或点下面「＋ 手动加一行」。':
      'No rows awaiting confirmation — upload a screenshot, or click “+ Add a row manually” below.',
    '还没有录入任何外部统计 —— 角色管理页现在用的是「接口窗口 ＋ 截图补录」两源的推算值。':
      'No external stats recorded yet — the Characters page is currently using the two-source estimate from “API window + screenshot backfill”.',
    '还剩 {n} 抽必出':
      '{n} warps left until it must drop',
    '还需':
      'Still needed',
    '还需 <b>{d}</b> 抽 · 实际把握 <b>{c}</b>':
      '<b>{d}</b> more warps · actual confidence <b>{c}</b>',
    '灰度化 {a} → 工作尺寸 {b}…':
      'Greyscaling {a} → working size {b}…',
    '回到顶部':
      'Back to top',
    '吉时':
      'Auspicious hour',
    '吉凶':
      'Auspiciousness',
    '吉凶依据':
      'Basis',
    '记录时刻':
      'Recorded at',
    '记录数':
      'Records',
    '忌':
      'Avoid',
    '检测图标位置…':
      'Detecting icon positions…',
    '检出 {n} 个候选区域，准备比对图标库…':
      'Found {n} candidate regions; preparing to match against the icon library…',
    '角色 ＋ 专属光锥':
      'Character + signature light cone',
    '角色池 {i}/{tt} 个卡池、光锥池 {j}/{tu} 个卡池可由数据自身推出 UP':
      '{i}/{tt} character banners and {j}/{tu} light cone banners have a featured UP derivable from the data itself',
    '角色图标':
      'Character icon',
    '角色右下角 N 命':
      'Character, bottom-right: “E N”',
    '接口保留期之外的历史已经无法恢复，所以<b>「总抽数 / 五星数」这两个总量用人工补填</b>——重新看一次总量（任意来源）就把数字填进来。<b>其余口径全自动衍生</b>，不要再手工维护别的字段。':
      'History older than the API retention window cannot be recovered, so <b>the two totals — total warps and total 5★ — are entered by hand</b>: look the totals up once from any source and type the numbers in. <b>Every other figure is derived automatically</b>; do not maintain any other field manually.',
    '截至快照时的累计抽数':
      'Cumulative warps as of the snapshot',
    '解释 · 白话':
      'Commentary · plain reading',
    '今日吉时':
      'Auspicious hours today',
    '今日无吉时 · 退求其次':
      'No auspicious hour today · next best',
    '今日运势':
      'Today’s fortune',
    '今日最宜':
      'Best today',
    '金环 = 五星':
      'Gold ring = 5★',
    '近期总抽数起点':
      'Start of the recent-warps window',
    '静':
      'static',
    '卡池':
      'Banner',
    '卡池日历取不到：':
      'Banner calendar unavailable: ',
    '卡池日历未就绪':
      'Banner calendar not ready',
    '卡池于 <b>{end}</b> 关闭':
      'The banner closes at <b>{end}</b>',
    '开池时刻与本地抽卡记录的首抽时间对得上':
      'Banner open time matches the first warp in your local history',
    '开始摇卦':
      'Cast the hexagram',
    '开始抓取并合并':
      'Start fetching and merging',
    '刻度':
      'Scale',
    '口径与免责':
      'Scope & disclaimer',
    '跨度':
      'Span',
    '快照时间':
      'Snapshot time',
    '快照时刻':
      'Snapshot taken at',
    '拉到':
      'Fetched',
    '来源':
      'Source',
    '蓝环 = 三星':
      'Blue ring = 3★',
    '老阳 3/16 · 少阴 7/16 · 少阳 5/16 · 老阴 1/16':
      'Old Yang 3/16 · Young Yin 7/16 · Young Yang 5/16 · Old Yin 1/16',
    '类型':
      'Type',
    '累计把握':
      'Cumulative confidence',
    '联动':
      'Collab',
    '联动池出货（记录走 <code>getLdGachaLog</code> 端点），单列一支、不与常规 UP 混':
      'Collab banner 5★ (recorded through the <code>getLdGachaLog</code> endpoint), listed separately and never mixed into the regular UP figures',
    '两条端点 / 滑动窗口 →':
      'Two endpoints / sliding window →',
    '灵敏度':
      'Sensitivity',
    '另一端点':
      'Other endpoint',
    '六爻':
      'Six lines',
    '六爻皆不动，与本卦相同':
      'no moving lines — identical to the primary hexagram',
    '每次点「保存并更新」都会把这次输入的字段原样留档，最新在上。':
      'Every press of “Save & update” files the entered fields verbatim, newest first.',
    '每格左边是角色，右边是他的<b>专属光锥</b>（同期上架的那张）':
      'In each cell the character sits on the left and their <b>signature light cone</b> (the one released alongside) on the right',
    '免责':
      'Disclaimer',
    '名次':
      'Rank',
    '名字':
      'Name',
    '目前还没有外部统计，读数与「两源合并」时一致。':
      'No external stats yet, so the figures match the two-source merge.',
    '目前外部统计生效 <b>{n}</b> 条（{at}）。':
      '<b>{n}</b> external stats entries are in effect ({at}).',
    '拿当期限定 · 把握线':
      'Get the featured limited · confidence line',
    '判定':
      'Verdict',
    '判定方式是把引文里的吉凶字眼按一张固定的词表打分管，<b>命中的字词全部列在上方</b>，可逐条复核。档位阈值按 12000 次抽样的分数分布分位数定，所以「大吉」约占一成、不是随手给的好话。':
      'Scoring works by points from a fixed word list of auspicious and ominous characters found in the quoted text, and <b>every matched word is listed above</b> so you can check it yourself. Tier thresholds are set from quantiles of the score distribution over 12,000 samples, which is why “Great Fortune” lands around one time in ten rather than being handed out as a compliment.',
    '匹配中 {i}/{n}…':
      'Matching {i}/{n}…',
    '平常':
      'Neutral',
    '平均还需':
      'Average still needed',
    '其余 {n} 天的完整排序 —— 点开':
      'Full ranking for the other {n} days — click to open',
    '起卦法':
      'Casting method',
    '起卦法：两种都是正统源流，动爻数分布完全相同':
      'Casting method: both are orthodox traditions and give identical moving-line distributions',
    '前两源是<b>从抽卡记录算</b>的；第三源（<b>外部统计补录</b>）是你在「抓取与数据管理 → ⑤」上传截图后人工确认的<b>真实持有状态</b>，按<b>真值快照</b>处理 —— 与抽卡推算不一致时<b>以外部为准</b>，并在行内标出冲突。':
      'The first two sources are <b>computed from warp history</b>; the third (<b>external stats</b>) is the <b>actual ownership state</b> you confirm by hand after uploading screenshots under “Fetch & Data → ⑤”, and is treated as a <b>ground-truth snapshot</b> — where it disagrees with the warp-history estimate <b>the external value wins</b>, and the conflict is flagged in the row.',
    '清空后角色管理页会退回两源推算值，截图留档不受影响。':
      'After clearing, the Characters page falls back to the two-source estimate; archived screenshots are untouched.',
    '清空全部外部统计':
      'Clear all external stats',
    '清空确认表':
      'Clear the confirmation table',
    '区间':
      'Range',
    '去左侧的「抓取与数据管理」粘贴一条抽卡链接，抓一次就有了。':
      'Paste a warp link under “Fetch & Data” on the left and run a single fetch — that is all it takes.',
    '确认表':
      'Confirmation table',
    '群星（常驻）池出货，普池没有 UP 概念':
      'Stellar (standard) pool 5★ — the standard pool has no featured concept',
    '日辰':
      'Day pillar',
    '日吉神':
      'Auspicious deities',
    '日家':
      'Day score',
    '日家打分口径（{n} 个维度 + 档位）—— 点开可逐条复核':
      'Day-scoring scope ({n} dimensions + tiers) — click through each item',
    '日家择吉 · 只在当期卡池剩下的 {n} 天里排':
      'Day selection · ranked only across the {n} days left on the current banner',
    '日期':
      'Date',
    '日凶煞':
      'Inauspicious influences',
    '三变归奇':
      'Three changes, remainders',
    '三变一爻 · 明细':
      'Three changes per line · detail',
    '三次一爻 · 明细':
      'Three throws per line · detail',
    '三枚铜钱':
      'Three coins',
    '三枚铜钱的正反':
      'Faces of three coins',
    '三源怎么合并 · 为什么可能缺 · 光锥归属怎么分 →':
      'How the three sources merge · why things can be missing · how light cones are attributed →',
    '扫描区间 {a} ~ {b}（{n} 天）':
      'Scanning {a} ~ {b} ({n} days)',
    '删掉这一行':
      'Delete this row',
    '升档与降档':
      'Tier upgrades and downgrades',
    '剩余 {n} 天':
      '{n} days left',
    '剩余期内择日':
      'Pick a day in the remaining window',
    '剩余期内择日取不到：':
      'Day selection unavailable: ',
    '十八变的归奇与余策':
      'Remainders and stalk counts across eighteen changes',
    '十二时辰的完整吉凶榜与打分依据见上方「今日吉时」。<b>卦与时辰互不改数</b>：时辰只回答「什么时候出手」，出手抽多少仍由保底模型给出。':
      'The full twelve-hour ranking and its scoring basis are in “Auspicious hours today” above. <b>The hexagram and the hour never change each other’s numbers</b>: the hour only answers “when to spend”, and how much to spend still comes from the pity model.',
    '时辰':
      'Hour',
    '时段':
      'Time span',
    '时机推演':
      'Timing projection',
    '时家择吉 · 十二时辰排序 · 万年历':
      'Hour selection · twelve-hour ranking · perpetual calendar',
    '时间区间':
      'Time range',
    '识别':
      'Recognised',
    '始发（新手）池出货，同样没有 UP 概念':
      'Departure (beginner) pool 5★ — likewise no featured concept',
    '收起当前页签里已展开的 {n} 个卡池明细':
      'Collapse the {n} expanded banner details in this tab',
    '手动':
      'Manual',
    '输入名字（可搜索）':
      'Type a name (searchable)',
    '数据管理':
      'Data',
    '数据区间':
      'Data range',
    '数据只存本机':
      'Data stays on this machine',
    '数据总貌':
      'Data overview',
    '四十九策 · 三变一爻':
      'Forty-nine stalks · three changes per line',
    '它只提供<b>星魂 / 叠影</b>，所以<b>不参与任何抽数口径</b>（总抽数 / 出金率 / 每 UP / 小保底不歪都不受影响）；与抽卡记录推算不一致时<b>以这里为准</b>，但会明确提示冲突在哪。':
      'It supplies only <b>Eidolons / Superimposition</b>, so it <b>feeds into no warp-count figure</b> (totals, 5★ rate, warps per UP and the 50/50 win rate are all unaffected); where it disagrees with the warp-history estimate <b>this is what counts</b>, but the conflict is called out explicitly.',
    '跳过动画':
      'Skip animation',
    '同一时点的五星总数':
      'Total 5★ as of a single moment',
    '头像与名称资源：本地 <code>assets/</code>（源自公开的角色资源库，抓取时自动补齐缺失图标）<br>本平台在你自己电脑上运行，数据只存在本机 <code>data/</code>，不联网上传任何内容':
      'Icons and names: local <code>assets/</code> (sourced from a public character asset library; missing icons are filled in automatically during a fetch)<br>This platform runs on your own computer, data lives only in the local <code>data/</code>, and nothing is uploaded anywhere',
    '头像与名称资源：本地 <code>assets/</code>（抓取时自动补齐缺失图标）<br>本页全部离线渲染，数据只存在本机 <code>data/</code>':
      'Icons and names: local <code>assets/</code> (missing icons are filled in automatically during a fetch)<br>This page renders entirely offline and data lives only in the local <code>data/</code>',
    '图':
      'Img',
    '彖传':
      'Tuan Zhuan',
    '歪':
      'Lost',
    '外部说 <b>{ext}</b>，抽卡记录推算 <b>{calc}</b>':
      'External stats say <b>{ext}</b>; the warp-history estimate says <b>{calc}</b>',
    '完成：{n} 个区域有识别结果':
      'Done: {n} regions produced a match',
    '唯一联网点：卡池日历':
      'Only network call: banner calendar',
    '未来 {n} 抽的累计把握曲线：实线 = 出金':
      'Cumulative confidence over the next {n} warps: solid = any 5★',
    '稳拿所需':
      'Guaranteed in',
    '五星':
      '5★',
    '五星光锥全览':
      'All 5★ light cones',
    '五星角色 × 专属光锥':
      '5★ characters × signature light cones',
    '五星角色 × 专属光锥 / 五星光锥全览':
      '5★ characters × signature light cones / all 5★ light cones',
    '五星角色 <b>{c}</b> 位（已持有专属光锥 <b>{own}</b> 位）· 五星光锥 <b>{l}</b> 张（限定 <b>{lim}</b> ＋ 常驻 <b>{std}</b>）· 三个来源合并后的结果':
      '<b>{c}</b> 5★ characters (<b>{own}</b> with their signature light cone) · <b>{l}</b> 5★ light cones (<b>{lim}</b> limited + <b>{std}</b> standard) · merged across all three sources',
    '五星数':
      '5★ count',
    '象曰：':
      'The Image says: ',
    '小保底':
      '50/50',
    '小保底 · 出金有 {p}% 是当期':
      '50/50 · {p}% of 5★ are the featured one',
    '小象':
      'Small Image',
    '小字那行是「命途 · 数据来源」；底部一行是该角色的专属光锥，<b>灰色「未获得」</b>即对应虚线圆圈。':
      'The small line reads “Path · data source”; the bottom row is that character’s signature light cone, and a <b>grey “Not owned”</b> corresponds to the dashed circle.',
    '新增':
      'New',
    '星魂 {r}（共 {cc} 个）':
      'Eidolon {r} ({cc} copies)',
    '星魂/叠影':
      'Eidolons / Superimposition',
    '凶时':
      'Inauspicious hour',
    '修改记录':
      'Edit history',
    '虚线圆圈':
      'Dashed circle',
    '需跨期 {n} 抽':
      'needs {n} warps across banners',
    '爻辞':
      'Line text',
    '爻位':
      'Line',
    '爻象':
      'Line type',
    '摇卦时':
      'At casting',
    '一键收折':
      'Collapse all',
    '宜':
      'Do',
    '已保存 {n} 条（角色 {ch} / 光锥 {lc}）—— 角色管理页已更新':
      'Saved {n} rows ({ch} characters / {lc} light cones) — the Characters page is updated',
    '已保存 {n} 条（角色 {ch} / 光锥 {lc}），自动补齐了 {ic} 个图标 —— 角色管理页已更新':
      'Saved {n} rows ({ch} characters / {lc} light cones) and filled in {ic} icons automatically — the Characters page is updated',
    '已保存并更新：总抽数 {p} 抽 / 五星 {g} 金，快照时刻 {at}':
      'Saved and updated: {p} total warps / {g} 5★, snapshot taken at {at}',
    '已垫 / 硬保底':
      'Pity so far / hard pity',
    '已垫抽数':
      'Warps into pity',
    '已录入的外部统计':
      'External stats on file',
    '已清空外部统计':
      'External stats cleared',
    '已校准':
      'Calibrated',
    '异文':
      'Variants',
    '用来看<b>接口能回溯到多早</b>（滑动窗口的左端）、每个池当前垫了多少抽。':
      'Shows <b>how far back the API reaches</b> (the left edge of the sliding window) and how much pity each banner currently holds.',
    '用于确认接口可回溯的窗口':
      'Confirms the window the API can reach back to',
    '有 {n} 行没通过校验，<b>没有写入</b>：':
      '{n} rows failed validation and were <b>not saved</b>:',
    '语言':
      'Language',
    '杂卦传':
      'Zagua Zhuan',
    '在游戏里打开「跃迁记录」→ 点右上角的分享/导出拿到链接（形如 <code>...api/getGachaLog?authkey=...</code>），整条粘贴到下面。链接里的 <code>end_id</code> / <code>page</code> 会被自动忽略，不需要自己删。<br>':
      'In game, open “Warp History” → tap share/export in the top-right to get a link (shaped like <code>...api/getGachaLog?authkey=...</code>) and paste the whole thing below. The <code>end_id</code> / <code>page</code> parameters in the link are ignored automatically — there is no need to strip them yourself.<br>',
    '在预览上画出识别框':
      'Draw recognition boxes on the preview',
    '载入图标库 {d}/{n}…':
      'Loading icon library {d}/{n}…',
    '择日服务未就绪':
      'Day-selection service not ready',
    '择时':
      'Hour selection',
    '择时服务未就绪':
      'Hour-selection service not ready',
    '择时口径（4 个维度 + 档位阈值）—— 点开可逐条复核':
      'Hour-scoring scope (4 dimensions + tier thresholds) — click through each item',
    '择时数据取不到：':
      'Hour-selection data unavailable: ',
    '怎么看这两张图':
      'How to read these two charts',
    '粘贴抽卡链接 → 抓取 6 类跃迁池 → 按 id 去重合并进本地仓（<b>取并集，不覆盖</b>）→ 自动补齐缺失的角色头像与光锥图标<br>下方依次是：数据现状 · 各卡池时间边界 · <b>数据补填</b> · <b>外部统计补录</b> · 自检断言':
      'Paste a warp link → fetch all 6 warp banner types → deduplicate by id and merge into the local store (<b>union, never overwrite</b>) → fill in any missing character avatars and light cone icons automatically<br>Below, in order: data at a glance · per-banner time bounds · <b>backfill totals</b> · <b>external stats</b> · self-check assertions',
    '占卜服务未就绪':
      'Divination service not ready',
    '这份数据代表账号<b>此刻的真实持有状态</b>，重传一张更全的截图会把它整体顶掉（所以是覆盖，不是累加）。':
      'This data represents the account’s <b>actual ownership state right now</b>; re-uploading a more complete screenshot replaces it wholesale (a replace, not an append).',
    '这一页只放<b>当期结论</b>；口径与理由在「解释说明」，抓取 / 卡池边界 / 数据补填在「数据管理」→':
      'This page carries only the <b>current conclusions</b>; the reasoning and definitions live in “Guide”, while fetching / banner bounds / backfill live in “Data” →',
    '这张图读不出来（可能不是图片，或者格式不支持）':
      'This image could not be read (it may not be an image, or the format is unsupported)',
    '真实保底':
      'True pity',
    '正在读取本地抽卡数据…':
      'Reading local warp data…',
    '支持 PNG / JPG / WebP · 单张上限 24MB · 原图会留档在 <code>data/uploads/</code>，方便事后回溯':
      'Supports PNG / JPG / WebP · 24MB per image · originals are archived in <code>data/uploads/</code> for later review',
    '只匹配五星（更快，角色管理页本来就只统计五星）':
      'Match 5★ only (faster — the Characters page only counts 5★ anyway)',
    '只刷新图标与索引':
      'Refresh icons and indexes only',
    '只有卡池日历一项会联网，且失败自动降级到本地缓存 / 内置表':
      'The banner calendar is the only thing that goes online, and it falls back to a local cache / built-in table when it fails',
    '重新起卦':
      'Cast again',
    '逐个候选区域做匹配（{a} × {b}）…':
      'Matching candidate regions one by one ({a} × {b})…',
    '逐爻明细':
      'Line-by-line detail',
    '主判据':
      'Primary rule',
    '主判据命中：':
      'Primary-rule matches: ',
    '主题':
      'Theme',
    '抓取后自动补齐缺失图标':
      'Missing icons are filled in automatically after a fetch',
    '抓取会<b>同时请求两个端点</b>：普通池（角色/光锥/群星/新手）走 <code>getGachaLog</code>，联动池走 <code>getLdGachaLog</code> —— 只抓一个会静默漏掉整个联动池。':
      'A fetch <b>hits two endpoints at once</b>: regular banners (character / light cone / stellar / departure) go through <code>getGachaLog</code> and collab banners through <code>getLdGachaLog</code> — fetching only one silently drops the entire collab pool.',
    '抓取中…':
      'Fetching…',
    '抓完之后，本平台会在服务端跑一遍<b>构建时断言</b>，任何一条不过就直接报错、不给你看错数据：':
      'After a fetch, the server runs a set of <b>build-time assertions</b>; if any one of them fails it errors out immediately rather than showing you wrong data:',
    '专属光锥「{name}」本账号还没抽到':
      'This account has not pulled the signature light cone “{name}” yet',
    '子时口径':
      'Zi-hour convention',
    '紫环 = 四星':
      'Purple ring = 4★',
    '字 = 阴':
      'Obverse = Yin',
    '自动取本地仓最早记录，<b>不可修改</b>':
      'Automatically the earliest record in the local store; <b>not editable</b>',
    '自下而上：第一次 = 初爻':
      'Bottom-up: the first throw is the bottom line',
    '综合':
      'Overall',
    '总抽数':
      'Total warps',
    '总量基准：{p} 抽 / {g} 金 · 补填于 {at}':
      'Totals baseline: {p} warps / {g} 5★ · backfilled at {at}',
    '总量来自「数据补填」，比率类指标全部基于本地导入的跃迁记录实时计算':
      'Totals come from “backfill totals”; every rate figure is computed live from the locally imported warp records',
    '最佳时辰':
      'Best hour',
    '最近几次抓取':
      'Recent fetches',
    '最晚记录':
      'Latest record',
    '最早记录':
      'Earliest record',
    'gacha_id 切池规则 / UP 推定 / 吉凶算法 →':
      'gacha_id banner-splitting rules / UP inference / auspiciousness algorithm →',
    'ⓘ 解释说明':
      'ⓘ Guide',
    'ⓘ 逐项口径看「解释说明」':
      'ⓘ See “Guide” for the definition of each figure',
    'UID <b>{uid}</b> · 数据区间 <b>{from} → {to}</b> · 本地累计 <b>{n}</b> 条记录 · 分析于 {at}':
      'UID <b>{uid}</b> · data range <b>{from} → {to}</b> · <b>{n}</b> records locally · analysed {at}',
    'UP':
      'UP',
    'UP 光锥':
      'Featured light cone',
    'UP 角色':
      'Featured character',

    // ── 补齐批次 ──────────────────────────────────────────────────────────────
    // 上表生成之后又接了几处 t()：抓取 / 导入 / 补填的运行时提示文案。它们同样是
    // 从源码里扫出来的字面量（check-i18n 会核对），只是加得比表晚，直接附在末尾、
    // 不重排全文。（占卜的吉凶档位名由引擎在运行时给出，归上方的 RUNTIME 段。）
    '(早期导入)':
      '(early import)',
    '，正当吉时':
      ', currently a favourable hour',
    '抽':
      ' warps',
    '读状态失败：':
      'Failed to read the status: ',
    '读取图标库 / 外部统计失败：':
      'Failed to load the icon library / external stats: ',
    '请选 PNG / JPG / WebP 图片':
      'Choose a PNG / JPG / WebP image',
    '图标库还没载入完，稍等一下再试':
      'The icon library is still loading — try again in a moment',
    '准备…':
      'Preparing…',
    '上传留档 {name}…':
      'Uploading the archive copy {name}…',
    '识别完成：{n} 个区域（{ms}ms，工作尺寸 {work}）':
      'Recognition done: {n} regions ({ms}ms, working size {work})',
    '处理失败：':
      'Processing failed: ',
    '确认表里还没有有效行（每行都要有类型和名字）':
      'The confirmation table has no valid rows yet (every row needs a type and a name)',
    '未识别':
      'Not recognised',
    '启动抓取失败：':
      'Failed to start the fetch: ',
    '「总抽数」要填一个正整数':
      '“Total warps” must be a positive whole number',
    '「五星数」要填一个非负整数':
      '“5★ count” must be a whole number, zero or more',
    '「快照时间」格式应为 2026-09-16 或 2026-09-16 09:07:12':
      '“Snapshot time” must look like 2026-09-16 or 2026-09-16 09:07:12',
    '「快照时间」格式应为 2026-09-17 或 2026-09-17 09:07:12':
      '“Snapshot time” must look like 2026-09-17 or 2026-09-17 09:07:12',
    '保存失败：':
      'Save failed: ',
    '刷新图标失败：':
      'Failed to refresh icons: ',
    '清空失败：':
      'Failed to clear: ',
    '清空全部外部统计？角色管理页会退回到「接口窗口 ＋ 截图补录」两源的推算值。':
      'Clear all external stats? The Characters page will fall back to the two-source estimate from “API window + screenshot backfill”.',
    '正在实时跟随当前时间（精确到秒）':
      'Following the current time live (to the second)',
    '已手动填到「日」':
      'Filled in to the day',
    '已手动填到「日」→ 按该日结束 23:59:59 算增量分界':
      'Filled in to the day → the delta boundary uses that day’s end, 23:59:59',
    '已手动填写，不再跟随':
      'Entered by hand; no longer following',
    '已手动填写，不再跟随当前时间':
      'Entered by hand; no longer following the current time',
  };

  root.W.DICT_EN = Object.assign({}, RUNTIME, LITERAL);
  // 供 tools/check-i18n.js 识别「合法地不出现在源码字面量里」的条目
  root.W.DICT_RUNTIME_KEYS = Object.keys(RUNTIME);
})(typeof window !== 'undefined' ? window : globalThis);
