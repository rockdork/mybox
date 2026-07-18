# mybox 设计方案（Design Spec）

> 状态：v2.1 · 已对齐方向（Apple 原生风 / 浅色+深色双主题）
> 维护人：AI（WorkBuddy）维护，随迭代更新
> 用途：所有 UI 与交互改动都以本方案为唯一标准，禁止临时拍脑袋调样式。

---

## 0. 一句话定位

mybox 是一个**本地优先的 Mac 主库收集箱**。视觉上应当像一台"原生 Mac 应用"——克制、干净、安静，把注意力留给内容本身，而不是界面装饰。

---

## 1. 设计原则

1. **原生感优先**：用系统字体、系统色（systemBlue 等）、系统级圆角与间距，让人觉得它"本来就是 macOS 的一部分"。
2. **内容优先，界面退后**：界面元素安静、低对比（灰阶为主），强调色只在关键操作处出现一次。
3. **一致性即专业**：所有颜色、圆角、间距、动效都来自下方 token，禁止在组件里写死数值。
4. **可预测的交互**：hover / 选中 / 按下三态清晰；危险操作显式、可逆。
5. **轻动效**：过渡短而柔（0.15–0.22s），尊重 `prefers-reduced-motion`。

---

## 2. 视觉语言（Token）

所有 token 在 `:root`（或未来 `App.css` 顶层）定义，组件只能引用变量名。

### 2.1 色彩

```css
:root {
  /* 强调色：系统蓝 */
  --accent:        #007AFF;   /* 主操作、链接、选中态文字 */
  --accent-hover:  #0066D6;   /* 主按钮 hover */
  --accent-press:  #005BBF;   /* 主按钮按下 */
  --accent-weak:   rgba(0,122,255,0.10); /* 选中态背景、聚焦环底 */

  /* 文字（Apple label 体系） */
  --text:          #1D1D1F;   /* 主文字 label */
  --text-2:        rgba(60,60,67,0.60);  /* 次要 secondaryLabel */
  --text-3:        rgba(60,60,67,0.30);  /* 辅助 tertiaryLabel */

  /* 表面与分隔 */
  --bg:            #F5F5F7;   /* 窗口背景（sidebar/主区底色） */
  --panel:         #FFFFFF;   /* 卡片、弹窗、输入框背景 */
  --line:          rgba(60,60,67,0.29);   /* 分隔线 hairline */
  --line-soft:     rgba(60,60,67,0.12);   /* 更弱的边框 */

  /* 交互态底色（统一 hover，不再写死 #f2f3f5） */
  --hover:         rgba(0,0,0,0.04);
  --hover-strong:  rgba(0,0,0,0.06);
  --press:         rgba(0,0,0,0.08);

  /* 危险（系统红） */
  --danger:        #FF3B30;
  --danger-weak:   rgba(255,59,48,0.10);
  --danger-line:   rgba(255,59,48,0.30);

  /* 类型强调（克制使用，仅小圆点/勾选圈） */
  --c-task:        #007AFF;   /* 任务：系统蓝，与强调色一致 */
  --c-note:        #34C759;   /* 笔记：系统绿，仅用于极少处辨识 */

  /* 语义色：来源 / 逾期 / 工作台分类 */
  --src-phone:     rgba(255,59,48,0.12);   /* 手机来源标签底 */
  --warn:          #FF9F0A;                 /* 逾期/提醒（系统橙） */
  --warn-weak:     rgba(255,159,10,0.12);
  --kind-web:      rgba(0,122,255,0.12);   /* 工作台：网页 */
  --kind-obsidian: rgba(139,92,246,0.14);  /* 工作台：Obsidian */
  --kind-app:      rgba(52,199,89,0.14);   /* 工作台：应用 */
  --kind-folder:   rgba(255,149,0,0.14);   /* 工作台：文件夹 */
}

> **边框使用纪律（重要）**：`--line` 仅用于「列表/分区之间的 hairline 分隔线」，绝不当作组件装饰边框滥用；`--line-soft` 仅用于卡片/输入框的极淡边界。输入区（搜索/快速添加）与次级按钮应使用「浅灰填充背景（`--hover`）」代替边框，聚焦/选中时才出现 `--accent` 边。违反此纪律会导致满屏灰线、偏离原生克制感（已实现中踩过此坑并修正）。

> 说明：原 `#2f80ed` 蓝改为系统蓝 `#007AFF`；原散落的 `#1f2329/#646a73/#9aa0a8` 收编为 label 体系；原写死的 `#f2f3f5` hover 统一为 `--hover`。

### 2.1b 深色主题 Token（Apple 深色配色）

浅色为默认 `:root`；深色统一写在 `:root[data-theme="dark"]`，由 §2.7 的切换机制触发。

```css
/* —— 深色主题（Apple 深色配色，对应浅色逐项一致） —— */
:root[data-theme="dark"] {
  /* 强调色：深色系统蓝 */
  --accent:        #0A84FF;
  --accent-hover:  #409CFF;
  --accent-press:  #5AC8FA;   /* 深色按下：更亮反馈（hover=#409CFF，press 再亮一档） */
  --accent-weak:   rgba(10,132,255,0.20);

  /* 文字（深色 label 体系，白底叠加透明度） */
  --text:          rgba(255,255,255,0.92);
  --text-2:        rgba(255,255,255,0.60);
  --text-3:        rgba(255,255,255,0.30);

  /* 表面与分隔 */
  --bg:            #1C1C1E;   /* 窗口背景 */
  --panel:         #2C2C2E;   /* 卡片、弹窗、输入框 */
  --line:          rgba(255,255,255,0.24);  /* hairline */
  --line-soft:     rgba(255,255,255,0.12);  /* 弱边框 */

  /* 交互态底色（深色用白底叠加） */
  --hover:         rgba(255,255,255,0.08);
  --hover-strong:  rgba(255,255,255,0.12);
  --press:         rgba(255,255,255,0.16);

  /* 危险（深色系统红） */
  --danger:        #FF453A;
  --danger-weak:   rgba(255,69,58,0.20);
  --danger-line:   rgba(255,69,58,0.40);

  /* 类型强调 */
  --c-task:        #0A84FF;
  --c-note:        #30D158;

  /* 语义色（深色对应，见 §2.1c） */
  --src-phone:     rgba(255,69,58,0.18);
  --warn:          #FF9F0A;
  --warn-weak:     rgba(255,159,10,0.20);
  --kind-web:      rgba(10,132,255,0.22);
  --kind-obsidian: rgba(139,92,246,0.26);
  --kind-app:      rgba(48,209,88,0.24);
  --kind-folder:   rgba(255,159,10,0.24);

  /* 阴影（深色下更暗、更弱，避免光晕） */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.40);
  --shadow-md: 0 4px 16px rgba(0,0,0,0.50);
  --shadow-lg: 0 12px 40px rgba(0,0,0,0.60);
}
```

### 2.2 字体排印

```css
--font: -apple-system, BlinkMacSystemFont, "SF Pro Text",
        "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;

--fs-caption: 11px;   /* 脚注、计数 */
--fs-small:   12px;   /* 次要说明、标签 */
--fs-body:    13px;   /* 默认 UI 文字 */
--fs-body-lg: 14px;   /* 输入框、行标题 */
--fs-title:   15px;   /* 导航项、列表行标题 */
--fs-subhead: 17px;   /* 区块标题 */
--fs-heading: 22px;   /* 页面标题 */

字重：400 regular / 500 medium / 600 semibold / 700 bold
行高：UI 1.4，正文 1.5；大标题 letter-spacing: -0.01em
```

### 2.3 间距（4 基准）

```css
--sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
--sp-5: 20px; --sp-6: 24px; --sp-8: 32px; --sp-10: 40px;
```

### 2.4 圆角（统一，禁止 7/9/10/14 等零散值）

```css
--r-xs: 4px;    /* 极小装饰 */
--r-sm: 6px;    /* 图标按钮 */
--r-md: 8px;    /* 输入框、按钮、下拉、导航项 */
--r-lg: 12px;   /* 卡片、快速添加条、设置卡 */
--r-xl: 16px;   /* 弹窗 */
--r-pill: 999px;/* 标签、胶囊 */
```

### 2.5 阴影 / 层级（Apple 极轻）

```css
--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);       /* 卡片静止 */
--shadow-md: 0 4px 16px rgba(0,0,0,0.08);      /* 悬浮卡片、popover */
--shadow-lg: 0 12px 40px rgba(0,0,0,0.16);     /* 弹窗 */
--focus-ring: 0 0 0 3px var(--accent-weak);    /* 聚焦环 */
```

### 2.6 图标

- 风格：线性描边，stroke `1.75–2px`，`stroke-linecap/linejoin: round`，`fill: none`，`currentColor`。
- 标准尺寸 token：`--ico-sm:16px` / `--ico:18px`（默认）/ `--ico-lg:20px` / `--ico-xl:24px`。
- 图标按钮命中区 ≥ 28×28px（推荐 32×32）。
- 复用现有 SVG 图标集，统一到上述 stroke 与尺寸，不混用填充图标（除非 SF Symbols 风格明确需要）。
- **图标库锁定**：统一使用 **lucide**（`https://lucide.dev`，线性描边风格，与上方 stroke 约定一致）。引入方式：以内联 `<svg>` 形式使用（取 lucide 的 path 数据，保持 `fill:none; stroke:currentColor; stroke-width:2`），**不引额外运行时依赖**、不走字体图标。新增图标必须先查 lucide 是否有对应图形，禁止临时粘贴未知来源 SVG（见 §8 平台约束）。

### 2.7 主题切换机制（浅色 / 深色 / 跟随系统）

- **三态**：`浅色` / `深色` / `跟随系统`（默认 `跟随系统`）。
- **实现方式（单一事实源，避免 CSS 媒体查询与 JS 各管一半）**：
  1. 根节点 `<html>` 打 `data-theme` 属性：`light` / `dark`。
  2. 选「跟随系统」时，由 JS 在启动时、以及 `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', …)` 监听系统变化时，把系统值写入 `data-theme`。
  3. 深色 token 仅定义在 `:root[data-theme="dark"]`（见 §2.1b），CSS 只认 `data-theme`，逻辑单一。
  4. 用户选择持久化到 `localStorage`（键如 `mybox-theme`），启动即应用；未来可并入设置库。
- **兜底**：CSS 保留 `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { /* 复用深色 token */ } }`，保证 JS 未初始化时窗口底色也正确（避免白屏闪一下）。
- **切换入口**：设置页新增「外观」分区，原生 segmented control 风格单选 `跟随系统 / 浅色 / 深色`。
- **切换过渡**：根节点加 `transition: background-color .2s ease, color .2s ease`；切换瞬间整体过渡克制，避免大面积闪烁；尊重 `prefers-reduced-motion`。

### 2.8 动效 Token（Motion）

```css
--dur-fast: 0.12s;   /* 显隐、opacity 类 */
--dur-base: 0.18s;   /* hover 底色、focus ring */
--dur-slow: 0.22s;   /* 位移、布局、侧栏收展 */
--ease:     cubic-bezier(0.32, 0.72, 0, 1);  /* Apple 标准缓动 */
```
> §5 交互表中的时长均引用上述 `--dur-*`；`prefers-reduced-motion` 下全部置 0（见 §6）。

### 2.9 层级 Token（z-index）

```css
--z-base:    1;    /* 普通内容 */
--z-sticky:  10;   /* 工具栏吸顶 */
--z-sidebar: 20;   /* 侧栏（始终在内容之上） */
--z-popover: 100;  /* tooltip / 下拉浮层 */
--z-modal:   1000; /* 弹窗遮罩 */
--z-toast:   1100; /* 轻提示 */
```
> 任何浮层必须引用上述变量，禁止写死裸数字；同层内靠 DOM 顺序兜底。

---

## 3. 布局结构

### 3.1 整体框架

- 应用为左 `sidebar` + 右 `main` 两栏，`height:100vh`，`overflow:hidden`。
- 侧栏展开 `240px`，收起 `68px`（原 236/64 → 统一为 240/68）。

### 3.2 侧栏（Sidebar）

- 背景 `--bg`，右侧 `1px solid var(--line-soft)` 分隔。
- 结构自上而下：
  1. **品牌区**：`brand-mark`（圆角方形，accent 底 + 白色对勾）+ `brand-name`「mybox」；右侧 `brand-toggle`（收起/展开，仅图标）。
  2. **导航区（flex:1）**：`工作台` / `笔记` / `任务` 三项，每项 = 图标 + 文字 + 计数。
  3. **底部**：`设置` 入口（齿轮图标 + 文字）。
- 收起态：仅显示图标，文字/计数隐藏，宽度 68px，居中。

### 3.3 主区（Main）

- 背景 `--bg`，内边距 `--sp-6`（24px）。
- 自上而下：`快速添加条` → `工具栏（搜索 + 结果计数）` → `列表`。
- 列表行（见 4.2）。

### 3.4 工作台（Workbench）

- 主区内独立视图，最大宽度 `960px` 居中。
- 卡片网格 `grid-template-columns: repeat(auto-fill, minmax(96px,1fr))`，间距 `--sp-3`。
- 卡片：lucide 类型图标（44px 圆角底 `--r-lg`，按类型着 `kind-*` 底色 + `--kind-*-fg` 前景色）+ 名称（单行省略，`--fs-body`）+ hover 显隐的编辑/删除。类型图标来自锁定的 lucide 库，禁止 emoji。

### 3.5 设置页（Settings）

- 全屏覆盖层（`position:absolute; inset:0`），背景 `--bg`。
- 顶部 56px 头（返回 + 标题），内容最大宽 `680px` 居中。
- 卡片式分区（设置卡 `--r-lg` + `--line` 边 + `--shadow-sm`）。

---

## 4. 组件规范

> **Token 映射约定**：本节所有 `padding/gap/圆角/字号` 均对应 §2 的 `--sp-*` / `--r-*` / `--fs-*` / `--dur-*` / `--z-*`，不写死裸值。例如：导航项 `padding 9px 10px` ≈ `--sp-3 --sp-4`、`gap 10px` ≈ `--sp-4`；列表行 `padding 12px 10px` ≈ `--sp-4 --sp-4`。以下描述中直接写出 px 仅方便阅读，实现时一律改用对应 token。

### 4.1 导航项（nav-item）

| 态 | 表现 |
|---|---|
| 默认 | 透明底，`--text-2` 文字，图标 `--ico` |
| hover | 底 `--hover`，文字 `--text` |
| 选中(active) | 底 `--accent-weak`，文字 `--accent`，`font-weight:600` |
| 计数 | `--text-3`；选中时 `--accent`；`tabular-nums` |

圆角 `--r-md`，内边距 `9px 10px`，gap `10px`。

### 4.2 列表行（row）

- 单行布局：`[勾选圈?]  [标题 + 同行 meta]  [hover 操作]`，`gap:12px`，padding `12px 10px`。
- 任务有圆形勾选圈（默认描边 `--text-3`，完成填充 `--accent`）；笔记无圈。
- 标题 `--fs-title`，`font-weight:500`，`--text`；完成态 `line-through` + `--text-3`。
- meta（状态/时间/来源）同行右对齐，小标签（见 4.5），`--text-3`。
- hover：底 `--hover`，行尾操作（转任务/转笔记 + 删除图标）`opacity:0→1` 渐显。
- 编辑态：白底 + `1px solid --accent` 描边，纵向展开（标题输入 + 内容 textarea + 类型/状态选择 + 按钮）。

### 4.3 按钮（btn）

- 默认：白底，`1px solid --line`，`--r-md`，`--fs-body`，文字 `--text`；hover 底 `--hover`。
- 主要（primary）：底 `--accent`，文字白；hover `--accent-hover`，press `--accent-press`。
- 危险（danger）：文字 `--danger`，边 `--danger-line`；hover 底 `--danger-weak`。
- 图标按钮（icon-btn）：仅图标，`--r-sm`，`--hover` 底，危险态红；命中区 ≥ 28×28。

### 4.4 输入框 / 下拉（input / select）

- 白底，`1px solid --line`，`--r-md`，`--fs-body-lg`，`--text`；
- `:focus` → 边 `--accent` + `--focus-ring`。
- 快速添加条为"条"形态：白底卡 + 左加号图标 + 输入框 + 右主按钮，整体 `--r-lg`，focus-within 时边 `--accent` + ring。
- **Tauri webview 注意**：原生 `<select>` 下拉面板、滚动条、`::-webkit-scrollbar`、右键菜单均为**系统样式，不跟随本方案 token**。约定：下拉 / 滚动条统一用自定义样式（或显式接受系统样式并评估一致性影响），禁止裸用未定制原生控件破坏双主题一致性；若必须用原生 select，至少保证其所在容器外观与 `--panel/--line` 对齐。

### 4.5 标签（tag）

- 胶囊 `--r-pill`，`--fs-caption`，`--text-2` 文字，底 `--hover-strong`（中性）。
- 状态/来源可有极淡语义色：手机来源用 `--src-phone` 底；逾期用 `--warn/--warn-weak`（见 §2.1c）；保持低饱和。工作台分类卡片 emoji 底用 `--kind-*`（网页/obsidian/应用/文件夹各自底色，见 §2.1c）。
- 时间标签可去底色、仅 `--text-3` 文字。

### 4.6 弹窗（modal）

- 遮罩 `rgba(0,0,0,0.42)`，居中卡片 `--panel` + `--r-xl` + `--shadow-lg`，宽 `360px`。
- 标题 `--fs-title` 600；字段 label `--fs-small` `--text-3`；输入/下拉同 4.4；底部操作右对齐。

### 4.7 空态 / 错误

- 空态：居中 `--text-3`，`--fs-body`，上下留白充足。
- 错误：底 `--danger-weak`，文字 `--danger`，边 `--danger-line`，`--r-lg`，可点击关闭。

---

## 5. 交互模式

| 交互 | 规范 |
|---|---|
| hover | 底色 `--hover`（图标按钮），或底 `--hover-strong`；文字转 `--text` |
| 选中 | 底 `--accent-weak` + 文字 `--accent` |
| 按下 | 底 `--press`，或 `transform: translateY(0.5px)` |
| 聚焦 | `--focus-ring`（accent 3px 环），键盘可达 |
| 双击行 | 进入编辑态（既有约定，保留） |
| 行操作显隐 | hover 时 `opacity 0→1`，`transition 0.12s` |
| 侧栏收展 | 宽度 `transition 0.22s ease`；收起态仅图标、居中 |
| 窗口 ≤560px | 自动收起侧栏（仅自动收，不强制展开，尊重手动） |
| 动效时长 | 颜色/底色 0.15s；位移/布局 0.22s；尊重 `prefers-reduced-motion` |

---

## 6. 可访问性（A11y）

- 所有图标按钮带 `aria-label`。
- 可见焦点环（键盘导航可见），不依赖 `:hover`。
- 文字对比度满足 WCAG AA（浅色背景下 `--text-2` 用于次要信息，主信息用 `--text`）。
- 最小命中区：图标按钮 ≥ 28×28（推荐 32×32），导航项高度 ≥ 36px。

---

## 7. 当前不一致 → 改造清单（后续按此逐项对齐）

> 这是把现有 `App.css` 拉齐到本方案的待办，按优先级排：

- [ ] 颜色：强调色 `#2f80ed` → `#007AFF`；文字三档收编为 label token；hover 全量替换 `#f2f3f5` 为 `--hover`。
- [ ] 圆角：散点（7/8/9/10/12/14）→ 统一到 `--r-*` token（输入/按钮 8、卡片 12、弹窗 16、图标钮 6、标签 pill）。
- [ ] 间距：行内 padding、gap 改为 `--sp-*` token。
- [ ] 侧栏宽度 236/64 → 240/68。
- [ ] 阴影：新增 `--shadow-*` 三级，替换现有零散 `box-shadow`。
- [ ] 聚焦：新增 `--focus-ring`，补到输入/下拉/快速添加条/按钮。
- [ ] 图标：stroke 统一 1.75–2px，尺寸归一到 `--ico*` token。
- [ ] 字体：`font-family` 补 `"SF Pro Text"`，字号收编为 `--fs-*` token。
- [ ] 暗色：新增 `[data-theme="dark"]` token 块（见 §2.1b）+ 主题切换机制（见 §2.7）；默认跟随系统，设置页加「外观」三态开关（浅/深/跟随）。

---

## 8. 维护说明

- 任何 UI 改动先对照本文件；新增颜色/圆角/间距必须先在 §2 加 token，再在组件引用，不允许组件内写死。
- 本文件随版本演进，改动处更新顶部「状态」版本号（v1→v2…）。
- 如与用户当次口头指示冲突，以用户当次明确指示为准，但需同步回写本节保持单一事实源。
- **Tauri 平台约束**：webview 内原生 `<select>` / 滚动条 / 右键菜单为系统样式、不跟随 token；下拉与滚动条须自定义或显式接受；新增图标必须来自锁定的图标库（见 §2.6），禁止临时粘贴未知来源 SVG。
