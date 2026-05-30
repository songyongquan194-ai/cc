# C 盘安全清理工具 技术设计文档（TDD）

版本：v0.1
日期：2026-05-29
配套文档：[CDrive_Cleaner_PRD.md](CDrive_Cleaner_PRD.md)
状态：工程评审稿

> 本文档补齐 PRD 中缺失的工程化定义：技术栈、进程模型、数据 schema、状态机、错误码、性能指标、AI 接口契约、内置规则库与安全实现细节。PRD 负责"做什么"，本文负责"怎么做"。

---

## 1. 技术栈

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 桌面框架 | Electron 30+ | 生态成熟，主进程直接调用 Node fs / Win32 API |
| 前端框架 | React 18 + TypeScript 5 | 类型安全，组件化 |
| 构建工具 | Vite + electron-vite | 快速热更新，主/渲染/preload 三端统一构建 |
| UI 组件库 | Ant Design 5 | 自带 Table / Tree / Progress，适合数据密集型管理界面 |
| 状态管理 | Zustand | 轻量，无样板代码 |
| 本地存储 | sql.js（WASM SQLite） | 零原生编译，任意机器免 VS Build Tools 即可运行；仍是完整 SQLite，支持 PRD §14.3 全部查询维度。整库内存 + 防抖落盘，日志/清单库体量小开销可忽略。（原计划 better-sqlite3，因原生编译依赖改为 WASM） |
| 扫描并发 | Node worker_threads | 扫描不阻塞主线程与 UI |
| 打包 | electron-builder (NSIS) | 生成 Windows 安装包，支持自动更新预留 |
| 测试 | Vitest（单元）+ Playwright（E2E 预留） | |

### 1.1 关于"轻量化"的工程妥协

PRD §17.1 要求轻量化。Electron 体积较大，对应措施：

- 默认**不常驻后台**，关闭即退出，无系统托盘守护进程（MVP）。
- 扫描全部在 worker_threads，主进程空闲时内存回收。
- 不打包 Chromium 之外的重型依赖；UI 按需加载。
- 后续若需进一步瘦身，核心引擎（scan/clean/migrate）以纯 TS 实现，可平滑迁移到 Tauri，不与 Electron 强耦合（见 §2 分层）。

---

## 2. 进程与模块架构

```text
┌─────────────────────────────────────────────┐
│ Renderer (React UI)                          │
│  - 页面：引导/首页/扫描结果/冷藏区/观察/记录  │
│  - 只读展示 + 用户确认，无任何直接 FS 调用     │
└───────────────┬─────────────────────────────┘
                │ contextBridge IPC（类型化）
┌───────────────▼─────────────────────────────┐
│ Preload                                      │
│  - 暴露 window.api.{scan,clean,migrate,...}  │
│  - 白名单通道，禁用 nodeIntegration          │
└───────────────┬─────────────────────────────┘
┌───────────────▼─────────────────────────────┐
│ Main Process                                 │
│  ┌─────────────── core（纯 TS，可移植）─────┐ │
│  │ ScanEngine    扫描引擎（worker 调度）     │ │
│  │ RuleEngine    规则匹配与优先级裁决        │ │
│  │ Classifier    分类与风险定级              │ │
│  │ CleanService  安全清理（删除子项）        │ │
│  │ MigrateService 迁移/冷藏（copy→verify→del）│ │
│  │ RestoreService 恢复（状态机驱动）         │ │
│  │ WatchService  观察列表与到期提醒          │ │
│  │ SafetyGuard   路径校验/禁止目录/链接检测   │ │
│  │ AIService     AI 解释（按需，可禁用）     │ │
│  └──────────────────────────────────────────┘ │
│  ┌─────────────── infra ────────────────────┐ │
│  │ Db (SQLite)  日志/manifest/规则/设置持久化 │ │
│  │ FsAdapter    封装 fs，统一错误码           │ │
│  │ Logger       结构化审计日志                │ │
│  └──────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
```

**核心原则**：`core` 不依赖 Electron API，只依赖注入的 `FsAdapter` / `Db` 接口，保证可单元测试、可移植。

### 2.1 项目目录结构（规划）

```text
G:\AQ\
  CDrive_Cleaner_PRD.md
  TECH_DESIGN.md
  TASK_BOARD.md
  package.json
  electron.vite.config.ts
  src\
    main\           主进程入口、IPC 注册
      ipc\
      core\         上述 core 模块
      infra\
      workers\      scan.worker.ts
    preload\
      index.ts
    renderer\
      src\
        pages\
        components\
        store\
        api\        对 window.api 的类型封装
    shared\         主/渲染共享类型 (types.ts, errors.ts, rules 类型)
  rules\            内置规则 JSON（随包发布）
  resources\        图标等
```

---

## 3. 数据模型（SQLite Schema）

数据库文件默认位于 `%APPDATA%\CDriveCleaner\app.db`。

```sql
-- 设置（键值）
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL            -- JSON 字符串
);
-- 关键键：backup_drive_path, cold_storage_root, ai_enabled, ai_provider,
--          ai_api_key_ref, default_cold_period_days, excluded_dirs(JSON array)

-- 扫描批次
CREATE TABLE scans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL,          -- 'quick' | 'deep'
  started_at    TEXT NOT NULL,          -- ISO8601
  finished_at   TEXT,
  status        TEXT NOT NULL,          -- 'running'|'done'|'cancelled'|'failed'
  total_files   INTEGER DEFAULT 0,
  safe_bytes    INTEGER DEFAULT 0,
  migratable_bytes INTEGER DEFAULT 0,
  highrisk_bytes   INTEGER DEFAULT 0
);

-- 扫描命中项（不长期保留，仅最近一次结果用于展示）
CREATE TABLE scan_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id      INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  category     TEXT NOT NULL,          -- 见 §3.1 枚举
  risk_level   TEXT NOT NULL,          -- safe|low|medium|high|forbidden
  default_action TEXT NOT NULL,        -- none|clean|migrate
  matched_rule TEXT,                   -- 命中的规则 name
  mtime        TEXT,
  atime        TEXT,
  ext          TEXT,
  explain_tmpl TEXT                    -- 模板解释文本
);
CREATE INDEX idx_scan_items_scan ON scan_items(scan_id);
CREATE INDEX idx_scan_items_cat  ON scan_items(category);

-- 操作日志（PRD §14，永久审计）
CREATE TABLE operations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  op_type      TEXT NOT NULL,          -- scan|clean|migrate|restore|delete_cold
  path         TEXT,
  dest_path    TEXT,
  size_bytes   INTEGER,
  category     TEXT,
  risk_level   TEXT,
  action       TEXT,
  status       TEXT NOT NULL,          -- success|failed|skipped
  error_code   TEXT,                   -- 见 §6
  error_detail TEXT,
  user_confirm TEXT,                   -- 'none'|'normal'|'double'|'strong'
  ai_summary   TEXT,
  batch_id     TEXT                    -- 同一次批量操作共用
);
CREATE INDEX idx_ops_ts    ON operations(ts);
CREATE INDEX idx_ops_path  ON operations(path);
CREATE INDEX idx_ops_type  ON operations(op_type);
CREATE INDEX idx_ops_error ON operations(error_code);

-- 冷藏区清单（与备份盘 manifest.json 双写）
CREATE TABLE cold_items (
  id            TEXT PRIMARY KEY,       -- uuid
  original_path TEXT NOT NULL,
  cold_path     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  category      TEXT,
  risk_level    TEXT,
  mtime         TEXT,
  migrated_at   TEXT NOT NULL,
  reason        TEXT,
  explain       TEXT,
  checksum      TEXT,                   -- sha256，迁移前后校验
  cold_period_days INTEGER,            -- 30/60/90/-1(永久)
  expires_at    TEXT,                   -- null 表示永久
  state         TEXT NOT NULL,          -- active|restored|deleted|missing
  restorable    INTEGER DEFAULT 1
);

-- 观察列表（PRD §12）
CREATE TABLE watch_items (
  id          TEXT PRIMARY KEY,
  path        TEXT NOT NULL,
  size_bytes  INTEGER,
  category    TEXT,
  reason      TEXT,
  added_at    TEXT NOT NULL,
  period_days INTEGER NOT NULL,         -- 7/30/60/90
  remind_at   TEXT NOT NULL,
  last_seen_mtime TEXT,
  status      TEXT NOT NULL             -- watching|recently_used|vanished|handled
);

-- 用户自定义/排除规则（内置规则随包，用户规则入库）
CREATE TABLE user_rules (
  id          TEXT PRIMARY KEY,
  json        TEXT NOT NULL,            -- 见 §4 规则 schema
  source      TEXT NOT NULL,            -- 'exclude'|'nl_generated'
  enabled     INTEGER DEFAULT 1,
  created_at  TEXT NOT NULL
);
```

### 3.1 分类枚举（category）

与 PRD §8.1 对齐，代码侧使用稳定 key：

```
sys_temp, sys_update_cache, sys_thumbnail, sys_crashdump, sys_recyclebin,
browser_cache, browser_gpu, browser_sw, browser_download_cache, browser_profile,
chat_image, chat_video, chat_file, chat_log, chat_offline, chat_db,
dev_pkg_cache, dev_pip_cache, dev_jvm_cache, dev_cargo_cache, dev_node_modules, dev_build_output,
design_media_cache, design_ps_temp, design_proxy, design_render_cache,
game_update_cache, game_installer_cache, game_shader, game_log, game_save,
vm_docker_image, vm_docker_volume, vm_wsl, vm_hyperv_vmware_vbox, vm_snapshot,
pkg_installer, pkg_archive, pkg_driver,
media_video, media_audio, media_image, media_screenrec, media_export,
doc_office, doc_pdf, doc_source, doc_design_src, doc_data,
dup_exact, dup_suspect, dup_samename
```

### 3.2 冷藏区 manifest.json schema（PRD §10.3）

备份盘 `<root>\CDrive_ColdStorage\manifest.json`，作为 SQLite 之外的可移植真相源（拔盘后仍可读）：

```json
{
  "version": 1,
  "created_at": "2026-05-29T10:00:00+08:00",
  "items": [
    {
      "id": "uuid",
      "original_path": "C:\\Users\\Alex\\Downloads\\setup.iso",
      "cold_path": "D:\\CDrive_ColdStorage\\2026-05-29\\Unknown\\setup.iso",
      "size_bytes": 5583457382,
      "category": "pkg_installer",
      "risk_level": "low",
      "mtime": "2025-10-30T12:00:00+08:00",
      "migrated_at": "2026-05-29T10:05:00+08:00",
      "reason": "210 天未修改的安装镜像，可重新下载",
      "checksum": "sha256:...",
      "cold_period_days": 90,
      "expires_at": "2026-08-27T10:05:00+08:00",
      "state": "active",
      "restorable": true
    }
  ]
}
```

---

## 4. 规则系统设计（PRD §16）

### 4.1 规则 schema（扩展 PRD §16.2）

```jsonc
{
  "name": "Chrome Cache",
  "category": "browser_cache",
  "match": {
    "path_globs": ["%LOCALAPPDATA%\\Google\\Chrome\\User Data\\*\\Cache"],
    "ext_in": [],                  // 可选，按扩展名匹配
    "min_size_bytes": 0,
    "min_age_days": 1
  },
  "risk_level": "safe",            // safe|low|medium|high|forbidden
  "default_action": "clean",       // none|clean|migrate
  "delete_policy": "delete_children_only", // delete_children_only|delete_self|none
  "requires_app_closed": false,
  "explain": "浏览器缓存，可重新生成，清理后部分网页首次加载变慢。",
  "priority_class": 4              // 见 §4.2
}
```

`path_globs` 支持环境变量占位符（`%LOCALAPPDATA%` 等），运行时展开为当前用户实际路径。

### 4.2 优先级裁决（实现 PRD §16.3）

匹配引擎对每个文件/目录按 `priority_class` 由小到大裁决，**先命中即终止**，禁止低优先级覆盖高优先级：

| class | 类型 | 可否被覆盖 |
| --- | --- | --- |
| 0 | 禁止目录规则（System32/WinSxS/...） | 否 |
| 1 | 用户排除规则 | 否（仅用户本人修改） |
| 2 | 高风险保护规则 | 否（除非高级模式逐项确认） |
| 3 | 应用专用规则 | 是 |
| 4 | 通用文件类型规则 | 是 |
| 5 | AI 建议 | 仅作为展示，不改变 default_action |

### 4.3 内置规则库清单（MVP 首批，随包 `rules\builtin.json`）

> 路径中的占位符运行时展开。下列为 MVP 必备的最小可用集合，后续扩展。

**系统可清理（safe）**
- Windows 临时：`%TEMP%`, `C:\Windows\Temp`
- 缩略图缓存：`%LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache_*.db`
- 崩溃转储：`%LOCALAPPDATA%\CrashDumps`, `C:\Windows\Minidump`
- 回收站：`C:\$Recycle.Bin`（通过 Shell API 清空，不直接删文件）
- Windows Update 缓存：`C:\Windows\SoftwareDistribution\Download`（low，建议清理需停服务）

**浏览器缓存（safe，delete_children_only，profile 本身 forbidden）**
- Chrome/Edge：`%LOCALAPPDATA%\{Google\Chrome,Microsoft\Edge}\User Data\*\Cache`、`Code Cache`、`GPUCache`、`Service Worker\CacheStorage`
- Firefox：`%LOCALAPPDATA%\Mozilla\Firefox\Profiles\*\cache2`

**开发环境（medium，建议迁移）**
- npm：`%APPDATA%\npm-cache` / `%LOCALAPPDATA%\npm-cache`；pnpm：`%LOCALAPPDATA%\pnpm\store`
- pip：`%LOCALAPPDATA%\pip\Cache`
- Gradle：`%USERPROFILE%\.gradle\caches`；Maven：`%USERPROFILE%\.m2\repository`；NuGet：`%USERPROFILE%\.nuget\packages`
- Cargo：`%USERPROFILE%\.cargo\registry`
- `node_modules` / `target` / `dist` / `build` / `out`：按目录名匹配（medium，仅迁移建议）

**聊天协作（缓存 medium，数据库 high 仅展示）**
- 微信/QQ/钉钉/Teams/Slack 图片视频文件缓存（medium）
- 聊天记录数据库（`*.db`, `Msg*.db` 等）标记 high

**设计视频（medium）**
- Adobe Media Cache：`%APPDATA%\Adobe\Common\Media Cache*`
- Premiere/AE 预览与代理目录

**游戏启动器（shader/log safe，installer cache low，存档 high）**
- Steam shadercache、downloading；Epic、战网更新缓存

**虚拟化容器（high，仅展示）**
- Docker/WSL vhdx、VMware/VirtualBox 磁盘镜像

**禁止目录（forbidden，class 0）**
- `C:\Windows\System32`, `C:\Windows\WinSxS`, `C:\Windows\System32\drivers`, `C:\Program Files\WindowsApps`, `C:\Windows\Boot`, EFI 分区, 页面文件/休眠文件

---

## 5. 关键状态机

### 5.1 迁移（MigrateService）——实现 PRD §10.5"迁移完成前不删原文件"

```text
queued
  └─ precheck (空间/可写/非禁止/非占用)  ──fail──► failed(error_code)
       └─ copying (复制到冷藏区临时名 .part)
            └─ verifying (sha256 比对源/目标)  ──mismatch──► rollback ─► failed(E_CHECKSUM)
                 └─ commit (.part 改名 + 写 manifest + 入库)
                      └─ delete_source (删原文件)  ──fail──► done_source_kept(警告)
                           └─ done
```

不变量：源文件只有在 `verifying` 通过且 `commit` 完成后才删除；任一步失败，源文件保持不变（PRD §10.5）。

### 5.2 恢复（RestoreService）——实现 PRD §11.3

```text
start
  ├─ cold_missing            ──► fail(E_COLD_MISSING)，标记 restorable=false
  ├─ parent_missing          ──► ask_create_dir ─► (yes→continue / no→cancel)
  ├─ target_exists           ──► ask {keep_both(rename) | overwrite(double_confirm) | cancel}
  ├─ no_permission           ──► ask_alt_location
  ├─ insufficient_space      ──► ask {free_space | restore_other_drive}
  └─ ok ─► copy_back ─► verify ─► remove_cold(可选) ─► done
```

恢复失败**不删除冷藏文件**（PRD §11.4）。

---

## 6. 错误码定义

统一 `error_code`，记入 operations 表，UI 据此展示可执行替代方案：

| code | 含义 | 用户可执行动作 |
| --- | --- | --- |
| E_NO_BACKUP_DRIVE | 未设置备份盘 | 引导设置备份盘 |
| E_BACKUP_LOW_SPACE | 备份盘空间低于阈值 | 减少迁移项/更换备份盘 |
| E_PATH_FORBIDDEN | 命中禁止目录 | 操作被拒绝（不可执行） |
| E_PATH_EXCLUDED | 命中用户排除目录 | 跳过 |
| E_FILE_LOCKED | 文件被占用 | 关闭占用程序后重试 |
| E_NO_PERMISSION | 无读写权限 | 选择其他位置/以适当权限运行 |
| E_CHECKSUM | 迁移校验不一致 | 自动回滚，源文件保留 |
| E_DEST_EXISTS | 目标已存在 | 重命名/覆盖(二次确认)/取消 |
| E_COLD_MISSING | 冷藏文件丢失 | 展示日志，标记不可恢复 |
| E_PARENT_MISSING | 原父目录不存在 | 询问重建目录 |
| E_INSUFFICIENT_SPACE | 目标盘空间不足 | 释放空间/恢复到其他盘 |
| E_SYMLINK_SKIP | 命中符号链接/junction | 跳过（不跟随） |
| E_SOURCE_GONE | 源文件已不存在（扫描后被自动清理）或正被占用写入 | 记为跳过、不计失败；源原样保留 |
| E_UNKNOWN | 未分类错误 | 展示 error_detail，不重试 |

---

## 7. 安全实现细节（实现 PRD §17.2 / §7.4）

删除/迁移前 `SafetyGuard.assertSafe(path)` 必过校验：

1. 路径非空、规范化（`path.resolve`），拒绝相对路径。
2. 解析后**不得等于任何盘根**（`C:\`、`D:\`...）。
3. 不含通配符残留；逐项实际路径，不接受 glob 直接执行删除。
4. `fs.lstat` 检测 `isSymbolicLink()` 及 reparse point（junction）→ 命中即 `E_SYMLINK_SKIP`，不跟随。
5. 路径前缀比对禁止目录列表（class 0）→ `E_PATH_FORBIDDEN`。
6. 路径前缀比对用户排除列表 → `E_PATH_EXCLUDED`。
7. 迁移目标盘 ≠ C 盘，且 ≠ 系统关键目录。
8. 占用检测：尝试以独占方式打开，失败 → `E_FILE_LOCKED`，跳过不重试。

回收站清空使用 Windows Shell API（`SHEmptyRecycleBin`）而非直接删 `$Recycle.Bin`。

---

## 8. 性能指标（补 PRD 缺口）

| 指标 | 目标 |
| --- | --- |
| 快速扫描耗时 | 典型机器 < 8s（仅枚举元数据，不读内容） |
| 深度扫描 | 流式输出进度，可随时取消（< 200ms 内响应取消） |
| 扫描吞吐 | ≥ 20,000 文件/秒（仅 stat，worker 并发） |
| UI 进度刷新 | 节流 250ms 一次，避免 IPC 风暴 |
| 主进程空闲内存 | < 150MB（扫描结束释放 worker） |
| 扫描峰值内存 | 命中项分批写库，内存不随文件总数线性增长 |

实现要点：扫描结果不全量驻留内存，命中项按 batch（如 500 条）写入 `scan_items`，渲染层分页/虚拟滚动读取。

---

## 9. AI 接口契约（补 PRD §13 缺口）

AIService 与具体 Provider 解耦。**按需触发**（PRD §13.2）。Provider 仅 `LocalProvider`（Ollama 兼容 `/api/chat`、仅回环端点、无 API Key），**绝不向云端上传任何内容**。

- 解释（`explain`）、报告总结、规则解析：输入**仅元数据**。
- 文件识别（`identify`）：默认仅元数据；对**安全的小文本文件**（`core/ai/contentPeek.ts` 闸门：白名单扩展名、≤512KB、排除敏感文件/目录、高风险、二进制）可读取开头≤4KB 片段以提升准确度。片段经净化（二进制/敏感判定 + 截断）后**只发本机模型**。冷藏项原文件已迁走时经 `read_path` 从备份副本读取。模型不可用一律降级为基于路径的启发式描述。

### 9.1 单文件解释请求

```json
{
  "task": "explain_file",
  "file": {
    "path_masked": "C:\\Users\\<user>\\Downloads\\setup.iso",
    "size_bytes": 5583457382,
    "ext": ".iso",
    "mtime_days_ago": 210,
    "category": "pkg_installer",
    "matched_rule": "Generic ISO",
    "in_dir_type": "downloads"
  }
}
```

### 9.2 AI 输出（强制结构，对应 PRD §13.3）

```json
{
  "file_type": "安装镜像",
  "basis": ["位于 Downloads", "扩展名 .iso", "210 天未修改", "5.2GB"],
  "risk_level": "low",
  "recommended_action": "migrate",
  "uncertainty": "未做内容校验，无法确认镜像是否仍可用",
  "summary": "更像可重新下载的安装镜像，建议迁移冷藏而非直接删除。"
}
```

### 9.3 硬约束（实现 PRD §13.4 / §16.3）

- AI 输出 `recommended_action` 经 RuleEngine 二次裁决：若文件 risk_level 为 high/forbidden，AI 建议被降级为"仅展示"，不得改变 `default_action`。
- AI 不参与生成永久删除高风险文件的计划；自然语言规则生成结果进入预览清单，用户确认后才入 `user_rules`。
- Provider 抽象：`interface AIProvider { explain(req): Promise<AIResult> }`。MVP 默认 **用户自带 API Key**（解决待决策项），Key 经系统凭据管理（Windows Credential Manager）存储，DB 仅存引用 `ai_api_key_ref`。AI 可整体禁用，禁用时全部使用模板解释。

---

## 10. 待决策项处置建议（对应 PRD §21）

| PRD 待决策项 | 本文建议 | 理由 |
| --- | --- | --- |
| 备份盘最低剩余阈值 10GB vs 比例 | **取 max(10GB, 总容量×5%)** | 小盘绝对值兜底，大盘比例兜底 |
| 冷藏默认周期 30 vs 60 天 | **默认 90 天**，可选 30/60/永久 | 降低误判损失，到期仅提醒不自动删 |
| 日志 JSONL vs SQLite | **SQLite** | 满足 §14.3 多维查询；导出 JSON/CSV |
| 外接移动硬盘作备份盘 | **支持**，记录卷序列号，拔盘时标记"备份盘离线"，相关功能置灰 | |
| 高级模式高风险逐项迁移 | **MVP 不开放**，预留开关位 | 守住"高风险只展示"底线 |
| AI Key 自带 vs 产品统一 | **用户自带 Key**，存 Windows 凭据管理 | 成本与隐私可控，MVP 简化 |
| 隐私政策说明 | 首次引导加一屏"数据处理说明"：路径/文件名/日志仅本地，AI 仅按需发送元数据 | |

---

## 11. 测试策略

- **core 单元测试（Vitest）**：SafetyGuard 路径校验全部分支、RuleEngine 优先级裁决、迁移/恢复状态机（用内存 FsAdapter 模拟）。
- **关键安全用例必测**：根目录拒绝、符号链接跳过、禁止目录拒绝、迁移失败源文件保留、恢复失败冷藏文件保留、未设备份盘禁迁移。
- **E2E（Playwright，后续）**：引导流程、扫描→清理→迁移→恢复闭环。
- 验收对照 PRD §20 逐条。
