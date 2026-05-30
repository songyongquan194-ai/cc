# C 盘安全清理工具 开发任务板

版本：v0.1
日期：2026-05-30
配套：[CDrive_Cleaner_PRD.md](CDrive_Cleaner_PRD.md) · [TECH_DESIGN.md](TECH_DESIGN.md)

> 策略：**垂直切片优先**。先打通"扫描→分类→安全清理→迁移冷藏→恢复→日志"主链路成为可运行成品，再补重复文件/观察列表/AI。
> 状态图例：⬜ 待办 · 🟦 进行中 · ✅ 完成 · ⛔ 阻塞

> **进度（2026-05-30）**：**M0~M9 全部完成**。M0~M8 为 MVP + 全部增强（脚手架 / 安全内核 / 扫描分类 / 安全清理 / 迁移冷藏 / 恢复 / 引导与首页 / 打包验收 / 重复文件候选 / 观察列表 / AI 本地顾问 / 自然语言规则 / 可选托盘与到期提醒）。**M9 为真机使用后的加固与增强**（清理性能、扫描会话常驻、迁移兜底排除运行库、源已消失/占用判跳过、AI 检测修复、**AI 文件识别**、冷藏区搜索/识别栏等）。单测 **142/142** 通过，node/web typecheck 全绿，build 成功，NSIS 安装包 `CDriveCleaner-0.1.0-setup.exe` 与免安装 `win-unpacked` 均生成且启动建库正常，已配应用图标。**§20 验收清单全绿**。AI 严守「本地·零云端·仅建议·降级模板」边界；文件识别在用户主动触发时可读安全小文本片段，仅发本机模型、绝不出网；托盘默认关闭、关窗即退出。

---

## 里程碑总览

| 里程碑 | 目标 | 对应 PRD/TDD | 退出标准 |
| --- | --- | --- | --- |
| M0 工程脚手架 | 可启动空壳应用 | TDD §1,§2 | electron-vite 跑起来，IPC 通路打通 |
| M1 安全内核 | SafetyGuard + 规则引擎 + DB | TDD §3,§4,§7 | 安全单测全绿 |
| M2 扫描与分类 | 快速/深度扫描 + 分类展示 | PRD §7,§8 | 真机扫出分类结果并入库 |
| M3 安全清理 | 一键安全清理 + 日志 | PRD §6,§14,§15 | 安全项可清理且全程留痕 |
| M4 迁移与冷藏 | 备份盘 + 迁移 + 冷藏区 | PRD §5,§10 | 文件可迁移、manifest 双写 |
| M5 恢复 | 恢复 + 失败策略 | PRD §11 | 恢复闭环 + 失败有替代方案 |
| M6 引导与首页 | 首次引导 + 首页概览 | PRD §5,§6,§18 | 完整 UI 流程贯通 |
| M7 打包验收 | 安装包 + PRD §20 验收 | PRD §20 | NSIS 安装包可装可用 |
| M8 后续迭代 | 重复文件/观察列表/AI | PRD §9,§12,§13 | 单独迭代 |

---

## M0 · 工程脚手架 ✅

- ✅ T0.1 初始化 electron-vite + React + TS + Ant Design 项目（`package.json`、`electron.vite.config.ts`）
- ✅ T0.2 配置 main/preload/renderer 三端目录结构（TDD §2.1）
- ✅ T0.3 contextBridge 类型化 IPC 骨架：`window.api.ping()` 跑通
- ✅ T0.4 `shared/types.ts`、`shared/errors.ts`（错误码 TDD §6）落地
- ✅ T0.5 集成 better-sqlite3，应用启动建表（TDD §3 全部 schema）
- ✅ T0.6 Vitest 配置（ESLint/Prettier 后续按需）

## M1 · 安全内核（最高优先，先于任何删除/迁移）✅

- ✅ T1.1 `FsAdapter` 封装：lstat/readdir/copy/rename/unlink，统一抛错误码
- ✅ T1.2 `SafetyGuard.assertSafe()` 全部校验分支（TDD §7：根目录/通配/符号链接/禁止目录/排除目录/占用）
- ✅ T1.3 禁止目录常量表（TDD §4.3 forbidden 清单）
- ✅ T1.4 规则 schema 类型 + `builtin.json` 首批 16 条规则（TDD §4.3）
- ✅ T1.5 `RuleEngine`：glob 匹配 + 环境变量展开 + 优先级裁决（TDD §4.2）
- ✅ T1.6 `Classifier`：规则命中→category/risk/default_action
- ✅ T1.7 **安全单测全绿（27/27）**：根目录拒绝、symlink 跳过、禁止目录拒绝、优先级不可被低级覆盖、排除目录生效

## M2 · 扫描与分类 ✅

- ✅ T2.1 `Walker` 异步遍历，仅取元数据、不跟随符号链接/junction、无权限目录标记（TDD §7.4）。注：MVP 在主进程异步遍历（I/O 密集非阻塞），worker_threads 离线化列为后续优化。
- ✅ T2.2 `ScanEngine` 分类 + 聚合 + 命中项分批 `onBatch` 落 `scan_items`（TDD §8）
- ✅ T2.3 快速扫描目标集（PRD §7.1）：temp/缩略图/转储/浏览器缓存根
- ✅ T2.4 深度扫描目标集（PRD §7.2）：下载/桌面/AppData/开发缓存 + 大文件阈值识别
- ✅ T2.5 扫描进度流式 IPC（PRD §7.3），节流 250ms
- ✅ T2.6 取消扫描（取消令牌，循环即时检查）
- ✅ T2.7 扫描结果页 UI：聚合统计 + 分类表 + 风险标签 + 建议动作 + 文件钻取（PRD §18.3）
- ✅ T2.8 模板解释生成（规则 explain 字段，批量不调 AI，PRD §13.2）

> M2 验证：41/41 单测通过（含真实磁盘集成测试：junction 不跟随、分类、大文件、磁盘空间）；node/web typecheck 全绿；build 成功；Electron 应用启动并加载 ScanService 无异常。

## M3 · 安全清理 ✅

- ✅ T3.1 `CleanService`：仅处理 safe/low+clean 项，逐项 SafetyGuard 复核，高风险/禁止硬拒绝
- ✅ T3.2 回收站经 Shell API 清空（`winShell.emptyRecycleBin` → PowerShell Clear-RecycleBin，TDD §4.3）
- ✅ T3.3 占用文件跳过并记录 `E_FILE_LOCKED`（skipCodes 不重试）
- ✅ T3.4 `CleanRunner` 逐项写 `operations`（user_confirm=normal + batch_id，PRD §14.1）
- ✅ T3.5 一键安全清理 UI（`CleanPanel`）：仅 safe/low+clean 进入，勾选 + 预计释放
- ✅ T3.6 普通确认弹窗（Modal.confirm 展示项数/释放空间，PRD §15.1）
- ✅ T3.7 操作报告：释放空间/成功/跳过/失败汇总

> M3 验证：49/49 单测通过（新增 CleanService 6 + CleanRunner 真实 fs 集成 2）；node/web typecheck 全绿；build 成功。清理链路 CleanPanel → IPC clean:run → CleanRunner → CleanService(SafetyGuard 复核) → operations 日志贯通。UI 按钮点击流仅手动验证（沙箱无法无头自动化）。

## M4 · 迁移与冷藏 ✅

- ✅ T4.1 备份盘设置：`BackupService` 选盘校验（非 C 盘 / 非系统目录 / 存在 / 可写探测 / 卷序列号）+ `SettingsView` UI（PRD §5.3）
- ✅ T4.2 空间阈值策略 `spacePolicy`（max(10GB,5%)，单次≤可用80%，迁后<15%告警）（PRD §5.4）
- ✅ T4.3 冷藏区目录结构初始化（`coldPath` 按日期/分类分目录 + `set()` 创建 logs + manifest）
- ✅ T4.4 `MigrateService` 状态机（copy(.part)→verify(sha256)→commit(rename)→delete_source）
- ✅ T4.5 迁移失败回滚 + 源文件保留不变量（校验不一致回滚 .part；删源失败记 source_kept）
- ✅ T4.6 `manifest.json` 与 `cold_items` 双写（`MigrateRunner` + `infra/manifest`）
- ✅ T4.7 迁移确认 UI（`MigratePanel`）：Modal 展示「释放 C 盘 / 占用备份盘 / 迁后剩余」三数字（PRD §5.4）
- ✅ T4.8 未设备份盘时迁移入口禁用（plan 返回 E_NO_BACKUP_DRIVE，按钮置灰 + 提示）
- ✅ T4.9 冷藏区页 UI（`ColdView`）：列表/原路径/到期/删除/延长（恢复留 M5）
- ✅ T4.10 冷藏周期（默认 90 天，可选 30/60/永久），到期仅展示不自动删

> M4 验证：63/63 单测通过（新增 spacePolicy 5 + MigrateService 6 + MigrateRunner 真实 fs 集成 3）；node/web typecheck 全绿；build 成功；Electron 启动无应用层报错。迁移链路 MigratePanel → migrate:plan/run → MigrateRunner → MigrateService(copy/verify/commit/del) → cold_items + manifest 双写 + operations 日志贯通。备份盘校验/冷藏区管理就绪。恢复（M5）将消费 cold_items/manifest。UI 按钮点击流仅手动验证（沙箱无法无头自动化）。

## M5 · 恢复

- ✅ T5.1 `RestoreService` 状态机（TDD §5.2）：precheck→copy(.part)→verify(sha256)→rename→removeCold(可选)
- ✅ T5.2 恢复前提检查（PRD §11.2）：cold_missing/forbidden_target/parent_missing/target_exists/insufficient_space
- ✅ T5.3 失败策略分支 UI（`RestoreModal`）：自动重建目录 + 同名三选项（keep_both/overwrite/cancel）+ 空间/丢失告警
- ✅ T5.4 覆盖恢复二次确认（Checkbox）；恢复到系统关键目录/盘根硬阻止（E_PATH_FORBIDDEN）
- ✅ T5.5 恢复失败不删冷藏文件（不变量，单测覆盖）；cold_missing 标记 state='missing' restorable=0
- ✅ T5.6 恢复记录写 operations（op_type='restore'，覆盖时 user_confirm='double'）+ manifest 状态回写

> **M5 验证**：74/74 单测通过（新增 RestoreService 8 + RestoreRunner 集成 3），node/web typecheck 全绿；build 成功；Electron 启动无应用层报错。恢复链路 RestoreModal → restore:precheck/run → RestoreRunner → RestoreService → cold_items/manifest 状态更新 + operations 日志贯通。UI 按钮点击流仅手动验证（沙箱无法无头自动化）。

## M6 · 引导与首页

- ✅ T6.1 首次引导（`Onboarding`，3 步 Steps）：产品原则 + 数据处理说明（本机处理/不上传）+ 设置备份盘 + 空间检查 + 进入扫描，落 `onboarding_done`
- ✅ T6.2 无备份盘兜底分支：引导可「暂不设置」；首页/设置提示仍可扫描+清理，迁移冷藏待设置后启用
- ✅ T6.3 首页概览（`HomeView`）：C 盘容量环图（<15% 告警）+ 可清理/可迁移/高风险/冷藏占用统计 + 备份盘在线状态 + 最近操作
- ✅ T6.4 用户排除目录设置入口（`SettingsView` TextArea，每行一目录，写 `excluded_dirs`）
- ✅ T6.5 操作记录页（`RecordsView`）：扫描/清理/迁移/恢复/删除/仅失败 分段筛选 + 导出 JSON/CSV（主进程 dialog 保存）

> **M6 验证**：77/77 单测通过（新增 StatsService 集成 3：overview 汇总 / failed 过滤 / CSV·JSON 导出），node/web typecheck 全绿；build 成功；Electron 启动无应用层报错。新增后端 `StatsService`（overview/operations/buildExport，只读聚合）+ IPC `overview:get` / `ops:list` / `ops:export`（dialog 写盘）。首页/记录/引导/排除目录 UI 串联完成。UI 点击流仅手动验证（沙箱无法无头自动化）。

## M7 · 打包与验收

- ✅ T7.1 electron-builder NSIS 配置 + 生成安装包：`dist/CDriveCleaner-0.1.0-setup.exe`（85.5 MB）。`sql.js` 的 `.wasm` 经 `asarUnpack` 解包；`rules/` 经 `extraResources` 进 `resources/rules`
- ✅ T7.2 PRD §20 验收清单逐条自测（见下，M5/M6 已全绿；M8 项标注待办）
- ◑ T7.3 冒烟：打包产物 `win-unpacked\CDriveCleaner.exe` 启动无应用层报错，成功加载 wasm 并创建 `app.db`（schema 初始化贯通）。完整 UI 全链路点击流需真机有头环境手动验证（沙箱无显示）
- ✅ T7.4 README / 使用说明（功能/安全不变量/开发/目录结构/打包/验收对照）

> **M7 验证**：`npm run package` exit=0；产物 `CDriveCleaner-0.1.0-setup.exe` 生成。打包布局核对：`app.asar.unpacked/.../sql.js/dist/sql-wasm.wasm` 已解包、`resources/rules/builtin.json` 就位。运行 `win-unpacked` 可执行无 wasm/资源缺失报错，并在 `%APPDATA%\cdrive-cleaner\app.db` 成功建库（证明 sql.js WASM 在生产布局下可加载、schema 初始化成功）。未签名（开发期无证书，已跳过签名）。

### PRD §20 验收对照清单（M7 必过）

- ✅ 未设备份盘时迁移/冷藏入口不可执行（MigratePanel 按钮 disabled + MigrateRunner.run 抛 NO_BACKUP_DRIVE）
- ✅ 备份盘空间不足时迁移计划不能提交（plan.allowed=false，run 拒绝）
- ✅ 每次迁移前展示 C 盘释放 + 备份盘占用（MigratePanel 三数字 Modal）
- ✅ 恢复失败给出可执行替代方案（RestoreModal 重建目录/同名三选项/空间提示）
- ✅ 重复文件列表默认不勾选删除（DuplicatesPanel 只展示、无删除入口，仅「加入观察列表」）
- ✅ 扫描后不对每个文件自动调 AI（无任何自动 AI 调用）
- ✅ 点击"为什么"能生成解释（WhyButton：本地 AI 启用时调用，未启用/不可用时降级规则模板；仅传元数据）
- ✅ 观察列表到期提醒（WatchView 进入即 check()，到期标 due + 顶部告警）
- ✅ 永久删除、覆盖恢复二次确认（ColdView 永久删除 danger 确认；RestoreModal 覆盖二次勾选）
- ✅ 日志可查清理/迁移/恢复/失败/确认记录（RecordsView 分段筛选 + 导出）
- ✅ 系统关键目录/排除目录/高风险数据不进一键操作（SafetyGuard + excluded_dirs + 高风险默认 action=none）

## M8 · 增强迭代

- ✅ T8.1 重复文件候选展示（PRD §9）：`core/DuplicateFinder`（同名同大小归一化分组 + 保留启发式，纯函数 6 单测）+ `DuplicateService`（按 scanId 分组，默认 ≥1MB）+ IPC `dup:groups` + `DuplicatesPanel`（只展示、可回收空间估算、加入观察列表，无删除入口）
- ✅ T8.2 观察列表 + 到期闭环（PRD §12）：`WatchService`（add 去重 / list / check 状态刷新：missing·recent·due / extend / ignore / remove / dueCount，绝不移动删除文件）+ IPC `watch:*` + `WatchView`（状态标签 + 到期告警 + 续期/忽略/移除）+ 扫描结果与重复候选均可一键加入
- ✅ T8.3 AI 顾问模块（PRD §13）：**本地、零云端、仅建议**。产品原理＝「直连 HTTP API ＋ Provider 抽象」，初期仅 `LocalProvider`（Ollama 兼容 `/api/chat`，仅允许回环地址，无 API key）。
  - 纯函数核心（可测）：`core/ai/prompt.ts`（结构化 prompt＋输出解析＋模板降级）、`core/ai/aiSafety.ts`（输出安全后处理：高风险/禁止项剔除删除措辞、NL 规则拒绝高风险/禁止目录、危险动作降级 migrate、强制最低优先级）、`core/ai/AIProvider.ts`＋`LocalProvider.ts`（注入 fetch）
  - `services/AIService.ts` 编排：探活→调用→schema 校验→安全后处理→降级模板→写 `ai_summary` 日志；`status/explain/summarizeReport/parseRule/saveRule/listRules/deleteRule`
  - IPC `ai:status/ai:explain/ai:summarizeReport/ai:parseRule`＋`rules:save/list/delete`；preload `api.ai`/`api.rules`
  - UI：`WhyButton`（扫描详情＆重复候选「为什么」，元数据-only，模板/AI 标签）；设置页 `AISettings`（启用开关＋本地端点＋模型名＋检测，隐私说明）
- ✅ T8.4 自然语言规则生成 + 预览确认（PRD §16.1）：`AISettings` NL 输入→`ai:parseRule`→`sanitizeRule` 安全收敛→**预览 Modal 确认后才落库**（`source='nl_generated'`，最低优先级）；`ScanService.reloadRules()` 使新规则当次扫描即生效；已添加规则可列表/删除
- ✅ T8.5 可选托盘 + 到期提醒 + 关于（PRD §17.1）：**默认关闭即退出，不常驻**。新增 `main/tray.ts`（运行时 base64 解码 16×16 图标，免打包二进制）+ 设置 `minimize_to_tray`（默认 false）。开启后：关窗→隐藏到托盘、托盘菜单「打开主界面/退出」、托盘 tooltip 显示到期数；启动做一次 `watch.check()` 并对到期项发**本地系统通知**（非后台监控、不联网）。IPC `tray:setEnabled / app:version / app:openExternal`（仅白名单 http/https）。设置页「后台与提醒」开关 +「关于」卡片（版本号 + 明示「不后台自动更新、不主动联网回传」）。`before-quit`/`window-all-closed` 正确销毁托盘与落库关库。

> **M8 验证**：**122/122 单测通过**（新增 AI prompt 12 + aiSafety 8 + LocalProvider 7 + AIService 集成 7 = 34），node/web typecheck 全绿；`npm run build` 成功。AI 安全不变量经测试锁定：仅回环端点（非本机端点 available()/complete() 直接拒绝、不触网）、高风险/禁止项删除建议被收敛、NL 规则命中系统目录被拒、危险动作降级 migrate、未启用/不可用/坏输出一律降级模板不抛错。T8.1~T8.5 全部完成。托盘默认关闭、关窗即退出，不违背 §17.1；开启后亦无全盘监控/联网，仅本地到期通知。

## M9 · 真机加固与增强（0.1.x，2026-05-30）✅

真机使用中暴露的问题修复与按需增强。均补单测、保持 typecheck/build 全绿。

- ✅ T9.1 清理性能：`CleanService` 改有界并发删除池（默认 16）+ `SafetyGuard.assertSafe({checkLock})` 删除路径跳过占用预检（unlink 失败自译 `FILE_LOCKED`）；`CleanRunner` 节流（~150ms）聚合进度经 `clean:progress` 推送；`CleanPanel` 实时进度条，解决"清理慢/界面像卡住"。
- ✅ T9.2 应用图标：`scripts/gen-icon.mjs` 纯 Node 生成多分辨率 `build/icon.ico`（antd 蓝圆角 + 白「C」），electron-builder 接入，替换默认 Electron 图标。
- ✅ T9.3 扫描会话常驻：渲染层 `store/scanStore.ts`（zustand）持有 scanning/progress/result + 模块级进度订阅；**切换界面不再中断扫描**（主进程本就在跑，仅 UI 曾丢状态）；中断改为显式「停止扫描」二次确认。
- ✅ T9.4 迁移兜底排除运行库：`core/largeFile.ts`，深度扫描"大文件兜底迁移"排除可执行/动态库/模型/运行时组件（`.dll/.exe/.model/.onnx`、`ComponentStore` 等）。修复"迁走剪映 onnxruntime/cuDNN 导致报错 1354"一类问题。
- ✅ T9.5 源已消失/占用判跳过：新增错误码 `SOURCE_GONE`；`NodeFsAdapter` 把 ENOENT 译为 `SOURCE_GONE`；`MigrateService`（迁移前 `exists` 复检 + 校验不一致=正在使用）与 `CleanService` 把"源已不存在/正在使用"记**跳过而非失败**；`MigratePanel` 报告新增「跳过」列与说明，避免误导性大额失败数。
- ✅ T9.6 冷藏区可读性：`ColdView` 原路径悬停看完整路径 + 一键复制 + 备份位置，新增**搜索**（原路径/备份位置/分类）；列宽与横向滚动修正。
- ✅ T9.7 AI 检测修复：`LocalProvider.available()` 的 `/api/tags` 探活去掉 GET 的空 body（真实 undici 对 GET+body 抛错导致始终"不可用"）；`AIService.status()` 改为纯连通性测试（未启用也可探活）。加回归测试模拟 undici 行为。
- ✅ T9.8 **AI 文件识别（PRD §13：AI 只做识别…）**：批量判断"这大概是什么"。`core/ai/contentPeek.ts` 安全闸门（白名单文本扩展名 + ≤512KB + 拒绝敏感文件/目录/高风险/二进制）+ 片段净化；`prompt.ts` 识别 prompt/解析/启发式降级（`format:json` 下用 `{"results":[...]}` 对象包数组才稳定）；`AIService.identify`（分批 + 受控读片段，冷藏项经 `read_path` 从备份副本读）；IPC `ai:identify`、preload `api.ai.identify`；`ScanView` 文件详情与 `ColdView` 均加「AI 识别本页」列。内容只发本机模型、绝不出网；模型不可用降级启发式。

> **M9 验证**：**142/142 单测通过**（M8 后新增 contentPeek/identify 19 + LocalProvider 回归 1，及 CleanService/MigrateService/ScanEngine 用例更新）。node/web typecheck 全绿；`npm run build` 成功；安装版 + 免安装版均重新生成。隐私边界变化已记入 PRD §13 / TECH_DESIGN：识别读内容仅本机、用户主动触发、安全文本限定。

---

## 关键依赖与风险

- M1 安全内核是所有写操作（清理/迁移/恢复）的前置，**必须先完成且单测全绿**，否则不得开工 M3/M4/M5。
- better-sqlite3 / 任何 native 模块需对 Electron ABI 做 rebuild，M0 阶段验证。
- 真机测试需谨慎：清理/迁移在真实 C 盘执行，开发期用临时目录或沙箱路径，避免误删开发者本机文件。
- 回收站、Shell API、占用检测在 Windows 上需 Node 原生或 PowerShell 桥接，M3 评估实现方式。
