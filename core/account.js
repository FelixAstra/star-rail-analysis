// ─────────────────────────────────────────────────────────────────────────────
// 崩铁抽卡分析平台 · 账号专属数据
//
// 读 `data/account.json` —— **这个文件不进公开仓库**（.gitignore 已排除）。
// 里面全是「本账号自己的历史」，换个账号就不成立，所以不能混进口径常量：
//   · crossGold  保底跨接口窗口边界的那两条金（gacha_id → 名字）
//   · histCross  上面那两条在工坊截图里的完整抽数
//   · histRows   活动池截图补录（接口保留期之外的五星）
//   · oth        常驻 / 新手池的截图补录（含当前已垫）
//   · wsBase     「数据补填」的兜底基准
//
// ⚠️ **文件不存在是正常情况**（全新 clone、或用户自己删了就是没有）。
//    这时一律返回空值，平台照样能跑，只是少了「截图补录」那块历史；
//    等你导入自己的记录、或按 README 填回 data/account.json，功能就齐了。
//    → 所以**所有消费方都必须能接受空值**，尤其是 analyze.js 里的两条断言。
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data/account.json');

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

function load() {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { raw = null; }
  const r = isObj(raw) ? raw : {};

  const crossGold = isObj(r.crossGold) ? r.crossGold : {};
  return {
    exists: !!raw,
    crossGold,
    histCross: isObj(r.histCross) ? r.histCross : {},
    histRows: Array.isArray(r.histRows) ? r.histRows : [],
    oth: Array.isArray(r.oth) ? r.oth : [],
    wsBase: isObj(r.wsBase) ? r.wsBase : null,
    // 「这条金是不是保底跨了接口窗口边界」—— 原来在 pools.js 里，现在跟着数据走
    isCross: (gid, name) => crossGold[String(gid)] === name,
  };
}

module.exports = { FILE, load };
