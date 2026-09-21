# 第三方组件与素材

本项目**零 npm 依赖**（`node_modules` 为空），但确实打包/引用了下面这些第三方内容。
按「随仓库分发的代码」与「运行时不下载的素材」两类分别列出。

---

## 一、随仓库分发的第三方代码

### 1. Vue 3

| 项 | 值 |
|---|---|
| 文件 | `web/vendor/vue.global.prod.js` |
| 版本 | 3.5.42（生产构建） |
| 许可证 | MIT |
| 版权 | Copyright (c) 2018-present, Yuxi (Evan) You and Vue contributors |
| 来源 | https://github.com/vuejs/core |
| 用途 | 前端框架。**本地 vendor，无构建步骤**（直接 `<script>` 引入全局 `Vue`） |

许可证全文见：https://github.com/vuejs/core/blob/main/LICENSE

### 2. lunar-javascript（6tail）

| 项 | 值 |
|---|---|
| 文件 | `core/lunar.js` |
| 版本 | UMD 单文件构建，**文件里没有内嵌版本号**（取自上游仓库 master 的 `dist/lunar.js`） |
| 许可证 | MIT |
| 版权 | Copyright (c) 6tail |
| 来源 | https://github.com/6tail/lunar-javascript |
| 用途 | 农历 / 干支 / 二十八宿 / 建除十二神 / 日家·时家十二天神 —— 「吉凶」评级的历法基础 |

许可证全文见：https://github.com/6tail/lunar-javascript/blob/master/LICENSE

---

## 二、运行时不下载的游戏素材（**不随仓库分发**）

这三块都被 `.gitignore` 排除，由平台在导入抽卡记录时自动下载到 `assets/`。

| 目录 | 内容 | 来源 |
|---|---|---|
| `assets/avatar/` | 角色头像（128px 圆） | `Mar-7th/StarRailRes` → `icon/avatar/{id}.png` |
| `assets/light_cone/` | 光锥图标 | `Mar-7th/StarRailRes` → `icon/light_cone/{id}.png` |
| `assets/index/` | 角色 / 光锥的名称、稀有度、命途索引 | `Mar-7th/StarRailRes` → `index_min/cn/{characters,light_cones}.json` |

- 上游仓库：https://github.com/Mar-7th/StarRailRes （本项目只做本地缓存，不修改内容）
- 下载逻辑：`server/icons.js`，校验方式是 **PNG 魔数 + 字节数下限**（不能只数文件个数 ——
  曾经因为「文件存在但内容是 404 页面」而假通过）。

> **版权归属**：上述图标与索引均来自游戏《崩坏：星穹铁道》，
> 版权归 **米哈游（上海米哈游影铁科技有限公司 / COGNOSPHERE）** 所有。
> 本项目仅出于个人分析目的在本地缓存使用，不主张任何权利。

---

## 三、仓库内确实包含的游戏素材

| 路径 | 说明 |
|---|---|
| `assets/help/*.png` | 「解释说明」页的 10 张界面配图 |

这些是**平台自己界面的截图**，画面里会出现角色头像与光锥图标，因此包含上面的游戏素材。
它们**是用虚构的演示数据拍摄的**（`node tools/make-demo-data.js`），不含任何真实账号信息，
仅用于说明用法。

---

## 四、非官方声明

本项目是**非官方**的个人工具，与米哈游 / COGNOSPHERE 无任何关联，未获其授权或认可。
抓取功能使用的是**玩家自己账号**在官方接口上的凭证（抽卡记录分享链接），
平台只监听 `127.0.0.1`，不向任何第三方服务器上传数据。

因使用本项目产生的任何后果由使用者自行承担。
