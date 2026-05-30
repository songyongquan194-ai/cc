# C 盘安全清理与文件冷藏（CDriveCleaner）

一个面向 Windows 的 C 盘空间清理工具。设计原则：

- **确定安全的**（系统临时文件、各类缓存、回收站等）→ 才自动清理；
- **不确定的** → 解释清楚、分类展示，优先**迁移到备份盘冷藏**，可随时一键恢复；
- **高风险内容**（个人文档、系统关键文件）→ 默认**不处理**。

所有扫描与分析均在本机完成，**不向任何云端上传文件内容或路径**。操作记录仅保存在本地数据库，可随时导出（JSON/CSV）。可选的 AI 能力只连接**本机** Ollama 兼容端点（默认 `http://localhost:11434`），零云端。

---

## 功能一览

| 模块 | 说明 |
| --- | --- |
| 首页概览 | C 盘容量（剩余 <15% 告警）、可清理/可迁移/高风险/冷藏占用统计、备份盘在线状态、最近操作 |
| 扫描与分类 | 快速 / 深度扫描；按风险等级与类别（系统临时、浏览器缓存、构建产物、安装包、大文件等）分类展示，附「为什么」解释 |
| 安全清理 | 仅清理 `safe/low` 且 `action=clean` 的项；逐项二次确认（数量 + 释放空间）；可清空回收站 |
| 迁移与冷藏 | 将 `action=migrate` 的文件复制到备份盘冷藏，校验（sha256）通过后再删源；迁移前展示「释放 C 盘 / 占用备份盘 / 迁后剩余」三数字 |
| 冷藏区 | 列表查看 / 搜索（原路径·备份位置·分类）/ 完整路径与一键复制 / 延长周期 / 永久删除 / **一键恢复到原位置** / **AI 识别本页** |
| 恢复 | 冲突处置（保留两者 / 覆盖 / 取消）、自动重建父目录、空间检查；恢复到系统关键目录被硬阻止；恢复失败绝不删冷藏副本 |
| 重复文件候选 | 同名同大小归一化分组 + 保留启发式，**仅展示、不默认删除**，可估算可回收空间、一键加入观察列表 |
| 观察列表 | 对"暂不决定"的文件记录并定期提醒（到期/丢失/最近）；**绝不移动或删除文件**；可续期/忽略/移除 |
| AI 顾问（可选，本地·零云端） | 连接本机 Ollama；按需点「为什么」解释某文件能否处理；可把自然语言整理需求转成清理规则（**预览确认后**才以最低优先级生效）；全程仅建议、不拥有删除/迁移权 |
| AI 文件识别（可选） | 扫描结果与冷藏区可「AI 识别本页」，用一句话判断"这大概是什么"。**仅对安全的小文本文件**读取开头片段提升准确度，敏感/高风险/二进制只看元数据；内容只发本机模型、绝不出网；模型不可用时降级为按路径的启发式描述 |
| 操作记录 | 扫描/清理/迁移/恢复/删除全量记录与失败原因；按类型/仅失败筛选；导出 JSON/CSV |
| 后台与提醒 | 可选系统托盘（**默认关闭、关窗即退出，不常驻**）；启用后关窗最小化到托盘并对到期项发本地通知；不联网、不后台监控 |
| 设置 | 备份盘设置与校验、默认冷藏周期、排除目录（扫描时完全跳过）、AI 顾问端点/模型/启用开关 |

---

## 安全不变量

- 迁移：源文件只有在**冷藏副本校验通过并提交后**才删除；中途失败保留源（`source_kept`）。
- 恢复：冷藏副本只有在**恢复成功后**（且用户勾选）才删除；失败一律保留。
- 写操作目标经 `SafetyGuard` 八步校验：禁止写入 C 盘系统关键目录、盘根；备份盘不能是系统盘。
- 备份盘空间策略：阈值 = max(10GB, 总容量×5%)；单批 ≤ 可用×80%；迁后 C 盘剩余 <15% 仅告警不阻断。
- 深度扫描"大文件兜底迁移"**排除可执行/动态库/运行时组件/模型**（`.dll/.exe/.sys/.model/.onnx`、`ComponentStore` 等），避免迁走应用运行库导致软件报错。
- 源文件在扫描后已被自动清理或正在被占用：清理/迁移记为**跳过（`SOURCE_GONE`/校验不一致）而非失败**，源文件原样保留。
- AI 识别读取内容受严格闸门：仅安全的小文本（白名单扩展名、≤512KB），**敏感文件**（`.env/.pem/.key`、含 secret/password/token/cookie，及 `.ssh/.aws/Cookies/Login Data` 等目录）、**高风险/禁止项、二进制一律只看元数据**；读到的片段只发本机模型、绝不出网。

---

## 开发

环境：Node 18+，Windows。存储采用 **sql.js（WASM SQLite）**，零原生编译，任意机器可运行。

```bash
npm install
npm run dev         # 启动开发（electron-vite）
npm test            # 运行单元/集成测试（vitest）
npm run typecheck   # 类型检查（main + renderer 双 tsconfig）
npm run build       # 构建产物到 out/
npm run package     # 构建 + electron-builder 生成 NSIS 安装包到 dist/
```

### 目录结构

```
src/
  main/
    core/        纯 TS 安全内核（依赖注入 FsAdapter/SafetyGuard，可单测）：
                 ScanEngine RuleEngine SafetyGuard CleanService MigrateService
                 RestoreService DuplicateFinder spacePolicy coldPath largeFile pathUtils
                 ai/  prompt aiSafety contentPeek AIProvider LocalProvider
    infra/       Db(sql.js) schema manifest rulesLoader
    services/    编排层（连接 core + Db + IPC + 进度推送）：
                 ScanService CleanRunner BackupService MigrateRunner
                 ColdService RestoreRunner StatsService DuplicateService
                 WatchService AIService
    tray.ts      可选系统托盘 + 本地到期通知（默认关闭）
    index.ts     Electron 主进程 + 白名单 IPC 注册
  preload/       contextBridge 暴露 window.api（白名单通道）
  renderer/      React + Ant Design UI（含 store/scanStore 常驻扫描会话）
  shared/        共享类型与错误码
rules/builtin.json   内置分类规则（打包进 resources/rules）
build/icon.ico       应用图标（gen-icon.mjs 生成）
```

### 架构要点

- **安全内核可测**：`core/` 全部纯函数 + 依赖注入，单测用 `MemoryFsAdapter` 覆盖；`services/` 用真实 fs + sql.js 做集成测试。
- **进程隔离**：`nodeIntegration:false` + `contextIsolation:true`，渲染层只能经 `window.api` 白名单通道访问主进程。
- **本地优先**：整库在内存，写操作防抖落盘；冷藏区附 `manifest.json` 作为可移植真相源。

---

## 打包说明

- `electron-builder.yml` 配置 NSIS 安装包（非一键、可改安装目录、桌面/开始菜单快捷方式）。
- `sql.js` 的 `.wasm` 通过 `asarUnpack` 解包到 `app.asar.unpacked`，保证主进程运行时可读取。
- 内置规则经 `extraResources` 复制到 `resources/rules`，主进程通过 `process.resourcesPath` 读取。

> 首次运行 `npm run package` 时，electron-builder 需联网下载 NSIS / winCodeSign 等构建工具。离线环境可预置其缓存（`%LOCALAPPDATA%\electron-builder\Cache`）。

---

## 验收对照（PRD §20）

| 项 | 状态 |
| --- | --- |
| 未设备份盘时迁移/冷藏入口不可执行 | ✅ |
| 备份盘空间不足时迁移计划不能提交 | ✅ |
| 每次迁移前展示 C 盘释放 + 备份盘占用 | ✅ |
| 恢复失败给出可执行替代方案 | ✅ |
| 扫描后不对每个文件自动调 AI | ✅（无自动 AI 调用；识别/解释均按需手动触发） |
| 点击"为什么"能生成解释 | ✅（本地 AI 启用时调用，未启用/不可用降级规则模板） |
| 重复文件默认不勾选删除 | ✅（只展示、无删除入口，仅「加入观察列表」） |
| 观察列表到期提醒 | ✅（进入即检查 + 顶部告警；可选托盘本地通知） |
| 系统关键/排除/高风险不进一键操作 | ✅（SafetyGuard + excluded_dirs + 高风险默认 none） |
| AI 仅连本机、绝不上传文件内容到云端 | ✅（仅回环端点；识别读片段也只发本机模型） |
