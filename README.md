# mybox · 本地化收集箱工具

一款 **Mac 桌面主库 + 局域网/手机网页访问 + iCloud 跨设备同步** 的本地化收集箱工具。
基于 Tauri 2 构建，所有数据存于本地 SQLite，不上传任何第三方服务器。

> 当前为 V1：单 Mac 主库，手机端为只读网页访问；多端实时同步通过 iCloud Drive 事件流实现（详见下方「iCloud 同步」）。

## 功能特性

- **工作台**：可配置常用链接 / 应用 / Obsidian 仓库 / 文件夹的启动器，支持分组、拖拽排序、折叠记忆。
- **笔记**：flomo 风格卡片流，快速记录灵感。
- **任务**：滴答清单风格，勾选完成、置灰删除线。
- **日历**：工作台右侧月视图，按日期聚合任务，有任务的日期显示标记，点选日期查看当天任务。
- **iCloud 同步**：选择 iCloud Drive 文件夹作为同步目录，多台 Mac 自动收敛一致、近实时互相同步（SQLite 主库本身不进 iCloud，仅同步增量事件）。
- **设置**：浅色 / 深色 / 跟随系统三态主题；数据目录自定义；同步开关与状态。

## 技术栈

- **框架**：Tauri 2 + React 19 + Vite + TypeScript
- **后端**：Rust（rusqlite bundled，直接操作 SQLite；notify 监听同步目录）
- **存储**：本地 SQLite（`inbox_items` + `change_log` 表），`change_log` 同时作为 iCloud 同步的事件载体
- **设计**：Apple 原生风，双主题，token 化 CSS（见 `docs/design-spec.md` 与 `docs/design-preview.html`）

## 环境要求

- macOS（当前仅构建 macOS 包）
- [Rust 工具链](https://rustup.rs/)（含 `cargo`）
- Node.js 20+
- Xcode Command Line Tools：`xcode-select --install`
- Tauri CLI（随项目 devDependency，无需全局安装）

## 开发 & 构建

```bash
# 1. 安装前端依赖
npm install

# 2. 开发模式（同时起 Vite + Rust 编译，热重载）
npm run tauri dev

# 3. 仅前端调试（不编译 Rust）
npm run dev

# 4. 生产构建（产出 .app 与 .dmg）
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`（已被 `.gitignore` 忽略，不进仓库）。

## 项目结构

```
inbox-tool/
├── src/                      # 前端（React）
│   ├── App.tsx               # 主界面、状态、同步监听
│   ├── App.css               # 双主题 token 化样式
│   ├── CalendarPanel.tsx     # 工作台右侧日历组件
│   ├── api.ts                # Tauri 命令调用封装
│   └── types.ts
├── src-tauri/                # Rust 后端
│   ├── src/
│   │   ├── lib.rs            # 命令注册、setup、同步启动
│   │   ├── crud.rs           # 条目增删改查
│   │   ├── sync.rs           # iCloud 同步引擎
│   │   ├── settings.rs       # 数据目录 / 同步目录设置
│   │   ├── workbench.rs      # 工作台启动器配置
│   │   └── db.rs / error.rs / migrate
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/                # 应用图标（提交）
├── docs/                     # 设计文档
├── .gitignore
└── package.json
```

## iCloud 同步说明

1. 设置页 → 同步 → 选择一个 **iCloud Drive 文件夹**（建议 `~/Library/Mobile Documents/com~apple~CloudDocs/...` 下）。
2. 本机任何增删改会写入该文件夹的轻量事件文件；另一台 Mac 通过文件夹监听自动重放并刷新。
3. 新 Mac：装好 app → 选同一 iCloud 文件夹 → 启动即自动收敛一致。
4. **SQLite 主库不进 iCloud**（避免多机并发写损坏），仅同步增量事件文件。

## 协作约定

- 主分支 `main` 受保护，所有改动走 **feature 分支 + Pull Request**。
- 提交信息建议中文、语义清晰（如「feat: 工作台日历联动任务」「fix: 拖拽抖动」）。
- 不要提交 `node_modules`、`src-tauri/target`、打包产物（`.app`/`.dmg`）、本地数据（`.sqlite`/`*.json` 运行配置）——这些已在 `.gitignore` 中约束。
- 大文件如需版本管理，请使用 Git LFS，不要直接塞进仓库。

## License

待定（如需开源请补充 LICENSE 文件）。
