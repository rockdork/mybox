import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import {
  createItem,
  listItems,
  updateItem,
  deleteItem,
  processItem,
  getSettings,
  setDataDir,
  openDataDir,
  getWorkbench,
  saveWorkbench,
  openLauncher,
  getSyncStatus,
  setSyncDir,
  disableSync,
  triggerSync,
  type AppSettings,
  type SyncStatus,
} from "./api";
import type {
  InboxItem,
  ItemType,
  ItemStatus,
  LauncherItem,
  LauncherKind,
  LauncherGroup,
  WorkbenchData,
} from "./types";
import CalendarPanel from "./CalendarPanel";
import "./App.css";

type Filter = ItemType;

const STATUS_LABELS: Record<ItemStatus, string> = {
  open: "待处理",
  done: "已完成",
  archived: "已归档",
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

const Ico = ({ d }: { d: string }) => (
  <svg
    className="ico"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

const CheckMark = ({ white = false }: { white?: boolean }) => (
  <svg
    className="check-svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke={white ? "#fff" : "currentColor"}
    strokeWidth={3}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const NAV: { key: Filter; label: string; d: string }[] = [
  {
    key: "note",
    label: "笔记",
    d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  },
  {
    key: "task",
    label: "任务",
    d: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  },
];

function App() {
  const [allItems, setAllItems] = useState<InboxItem[]>([]);
  const [filter, setFilter] = useState<Filter>("note");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editStatus, setEditStatus] = useState<ItemStatus>("open");
  const [editType, setEditType] = useState<ItemType>("note");

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [moving, setMoving] = useState(false);
  const [view, setView] = useState<"main" | "workbench" | "settings">("main");
  const [collapsed, setCollapsed] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // 同步状态 + 跨设备刷新计数（供工作台监听自动重载）
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncTick, setSyncTick] = useState(0);

  // —— 主题（浅色/深色/跟随系统），见 docs/design-spec.md §2.7 ——
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => {
    const s = localStorage.getItem("mybox-theme");
    return s === "light" || s === "dark" || s === "system" ? s : "system";
  });
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const t = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = t;
    };
    apply();
    if (theme === "system") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);
  const changeTheme = (t: "light" | "dark" | "system") => {
    localStorage.setItem("mybox-theme", t);
    setTheme(t);
  };

  // 窗口宽度变窄到阈值以下时自动收起侧栏（仅自动收起，不强制展开，尊重用户手动操作）
  const AUTO_COLLAPSE_WIDTH = 560;
  const collapsedRef = useRef(collapsed);
  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);

  useEffect(() => {
    let stopTimer: number | undefined;
    const onResize = () => {
      // 拖拽窗口尺寸期间暂停所有 CSS 过渡/动画，避免内容区抖动不跟手
      document.documentElement.classList.add("resizing");
      // 仅在「向下越过阈值且当前未收起」时收起一次，避免拖拽中反复 setState 重渲染
      if (window.innerWidth <= AUTO_COLLAPSE_WIDTH && !collapsedRef.current) {
        setCollapsed(true);
      }
      if (stopTimer) clearTimeout(stopTimer);
      // 松手 160ms 后再恢复过渡/动画（稍长一点，覆盖拖拽中偶发的停顿）
      stopTimer = window.setTimeout(() => {
        document.documentElement.classList.remove("resizing");
      }, 160);
    };
    window.addEventListener("resize", onResize);
    onResize(); // 初始若已处于窄窗口，直接收起
    return () => {
      window.removeEventListener("resize", onResize);
      if (stopTimer) clearTimeout(stopTimer);
    };
  }, []);

  // 点击收起/展开：临时给侧栏挂动画类触发 width 过渡，动画结束后移除，
  // 保证「仅手动折叠有平滑动画、拖拽窗口永不触发动画」（见 App.css .sidebar.animate-collapse）
  const toggleSidebar = () => {
    const sb = document.querySelector(".sidebar");
    if (sb) {
      sb.classList.add("animate-collapse");
      window.setTimeout(() => sb.classList.remove("animate-collapse"), 260);
    }
    setCollapsed((c) => !c);
  };

  const titleRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      // 始终拉取全量数据，类型筛选在前端做，保证侧栏计数始终反映全集
      setAllItems(await listItems(null));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 启动时读取数据保存位置设置
  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((e) => setError(String(e)));
  }, []);

  // 启动 + 数据位置变更后读取同步状态
  useEffect(() => {
    getSyncStatus()
      .then(setSyncStatus)
      .catch(() => {});
  }, [settings]);

  // 监听后端「sync-updated」：跨设备变更到达后刷新主区列表 + 工作台
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<unknown>("sync-updated", () => {
      load();
      setSyncTick((t) => t + 1);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSyncStatus = () => {
    getSyncStatus()
      .then(setSyncStatus)
      .catch(() => {});
  };

  // 选择 iCloud 文件夹作为同步目录（默认定位到 iCloud Drive 根）
  const chooseSyncDir = async () => {
    const selected = await open({
      directory: true,
      title: "选择 iCloud 同步文件夹",
      defaultPath:
        "~/Library/Mobile Documents/com~apple~CloudDocs",
    });
    if (!selected || Array.isArray(selected)) return;
    try {
      await setSyncDir(selected);
      refreshSyncStatus();
      load();
    } catch (e) {
      setError(String(e));
    }
  };

  const turnOffSync = async () => {
    if (!confirm("关闭同步？本地数据保留，但不再与其他设备同步。")) return;
    try {
      await disableSync();
      refreshSyncStatus();
    } catch (e) {
      setError(String(e));
    }
  };

  const manualSync = async () => {
    try {
      await triggerSync();
      refreshSyncStatus();
    } catch (e) {
      setError(String(e));
    }
  };

  const visible = useMemo(() => {
    return allItems.filter((i) => i.item_type === filter);
  }, [allItems, filter]);

  const counts = useMemo(() => {
    const c: Record<ItemType, number> = { note: 0, task: 0 };
    allItems.forEach((i) => {
      c[i.item_type]++;
    });
    return c;
  }, [allItems]);

  // 统一封装「执行变更 → 刷新列表 → 错误捕获」，消除各 handler 的重复 try/catch
  const mutate = async (work: () => Promise<unknown>) => {
    try {
      await work();
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const add = () => {
    const t = title.trim();
    if (!t) {
      titleRef.current?.focus();
      return;
    }
    mutate(async () => {
      await createItem(t, content.trim());
      setTitle("");
      setContent("");
      titleRef.current?.focus();
    });
  };

  const remove = (id: string) => {
    if (!confirm("确定删除这条？")) return;
    mutate(() => deleteItem(id));
  };

  const process = (id: string, target: ItemType) => {
    mutate(() => processItem(id, target));
  };

  const toggleStatus = (it: InboxItem) => {
    const next: ItemStatus = it.status === "done" ? "open" : "done";
    mutate(() => updateItem(it.id, it.title, it.content, next, it.item_type));
  };

  const startEdit = (it: InboxItem) => {
    setEditingId(it.id);
    setEditTitle(it.title);
    setEditContent(it.content);
    setEditStatus(it.status);
    setEditType(it.item_type);
  };

  const saveEdit = (id: string) => {
    mutate(async () => {
      await updateItem(id, editTitle.trim(), editContent.trim(), editStatus, editType);
      setEditingId(null);
    });
  };

  // 选择新保存位置：系统文件夹选择器 → 后端自动搬迁并记住
  const chooseDir = async () => {
    const selected = await open({
      directory: true,
      title: "选择数据保存位置",
      defaultPath: settings?.dataDir ?? undefined,
    });
    if (!selected || Array.isArray(selected)) return;
    setMoving(true);
    try {
      await setDataDir(selected);
      setSettings(await getSettings());
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setMoving(false);
    }
  };

  // 在访达中显示当前数据库文件
  const revealDir = () => {
    openDataDir().catch((e) => setError(String(e)));
  };

  return (
    <div className={`app ${collapsed ? "collapsed" : ""}`}>
      {view === "settings" ? (
        <div className="settings-view">
          <header className="settings-head">
            <button className="settings-back" onClick={() => setView("main")}>
              <Ico d="M15 18l-6-6 6-6" />
              <span>返回</span>
            </button>
            <div className="settings-title">设置</div>
          </header>

          <div className="settings-body">
            <section className="settings-card">
              <div className="settings-card-head">
                <div className="settings-card-title">数据保存位置</div>
                <div className="settings-card-desc">
                  本地 SQLite 主库存放的文件夹，可随时迁移。
                </div>
              </div>
              <div className="settings-path" title={settings?.currentDb ?? ""}>
                {settings ? settings.dataDir ?? settings.defaultDir : "读取中…"}
              </div>
              <div className="settings-actions">
                <button className="btn sm" onClick={chooseDir} disabled={moving}>
                  {moving ? "搬迁中…" : "更改位置"}
                </button>
                <button className="btn sm ghost" onClick={revealDir}>
                  在访达中显示
                </button>
              </div>
            </section>

            <section className="settings-card">
              <div className="settings-card-head">
                <div className="settings-card-title">外观</div>
                <div className="settings-card-desc">
                  选择浅色、深色，或跟随系统切换。
                </div>
              </div>
              <div className="seg">
                {(["system", "light", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    className={theme === t ? "active" : ""}
                    onClick={() => changeTheme(t)}
                  >
                    {t === "system" ? "跟随系统" : t === "light" ? "浅色" : "深色"}
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-card">
              <div className="settings-card-head">
                <div className="settings-card-title">同步</div>
                <div className="settings-card-desc">
                  选择 iCloud Drive 里的文件夹，多台 Mac 自动保持一致（实时同步）。
                </div>
              </div>
              {syncStatus && syncStatus.enabled ? (
                <>
                  <div className="settings-path" title={syncStatus.syncDir ?? ""}>
                    {syncStatus.syncDir}
                  </div>
                  <div className="sync-meta">
                    <span>
                      本机 ID：{syncStatus.machineId.slice(0, 8)}
                    </span>
                    <span>
                      {syncStatus.lastSynced
                        ? `最近同步：${new Date(syncStatus.lastSynced).toLocaleString("zh-CN")}`
                        : "尚未同步"}
                    </span>
                  </div>
                  <div className="settings-actions">
                    <button className="btn sm" onClick={manualSync}>
                      立即同步
                    </button>
                    <button className="btn sm ghost" onClick={turnOffSync}>
                      关闭同步
                    </button>
                  </div>
                </>
              ) : (
                <div className="settings-actions">
                  <button className="btn sm" onClick={chooseSyncDir}>
                    选择 iCloud 文件夹
                  </button>
                </div>
              )}
            </section>

            <section className="settings-card">
              <div className="settings-card-head">
                <div className="settings-card-title">关于</div>
              </div>
              <div className="settings-about">
                <div className="settings-about-row">
                  <span>应用</span>
                  <span>mybox</span>
                </div>
                <div className="settings-about-row">
                  <span>版本</span>
                  <span>0.1 · Mac 主库</span>
                </div>
                <div className="settings-about-row">
                  <span>模式</span>
                  <span>本地 · 离线优先</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      ) : (
        <>
          <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
        <div className="brand">
          {!collapsed && (
            <div className="brand-left">
              <button
                className="brand-mark"
                title="mybox"
              >
                <CheckMark white />
              </button>
              <div className="brand-text">
                <div className="brand-name">mybox</div>
              </div>
            </div>
          )}
          <button
            className="brand-toggle"
            onClick={toggleSidebar}
            title={collapsed ? "展开侧栏" : "收起侧栏"}
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          >
            <Ico d="M3 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M7 6v12" />
          </button>
        </div>

        <nav className="nav">
          <div className="sidebar-add">
            <button
              className="btn primary add-btn"
              onClick={() => setShowAddMenu((v) => !v)}
              onBlur={() => setTimeout(() => setShowAddMenu(false), 150)}
            >
              <Ico d="M12 5v14M5 12h14" />
              <span className="add-label">添加</span>
            </button>
            {showAddMenu && (
              <div className="add-menu">
                <button
                  className="add-opt"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setShowAddMenu(false);
                    setView("main");
                    setFilter("note");
                    setTimeout(() => titleRef.current?.focus(), 0);
                  }}
                >
                  <Ico d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                  添加笔记
                </button>
                <button
                  className="add-opt"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setShowAddMenu(false);
                    setView("main");
                    setFilter("task");
                    setTimeout(() => titleRef.current?.focus(), 0);
                  }}
                >
                  <Ico d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                  添加任务
                </button>
              </div>
            )}
          </div>

          <button
            className={`nav-item ${view === "workbench" ? "active" : ""}`}
            onClick={() => setView("workbench")}
            title="工作台"
          >
            <Ico d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
            <span className="nav-label">工作台</span>
          </button>
          {NAV.map((f) => (
            <button
              key={f.key}
              className={`nav-item ${filter === f.key && view === "main" ? "active" : ""}`}
              onClick={() => { setView("main"); setFilter(f.key); }}
              title={f.label}
            >
              <Ico d={f.d} />
              <span className="nav-label">{f.label}</span>
              <span className="nav-count">{counts[f.key]}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="settings-btn" onClick={() => setView("settings")}>
            <Ico d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.91L3.27 8.04a2 2 0 0 0 .9 2.73l.15.09a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.9 2.73l.73 1.29a2 2 0 0 0 2.73.9l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.9l.73-1.29a2 2 0 0 0-.9-2.73l-.15-.09a2 2 0 0 1-1-1.74V12.6a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .9-2.73l-.73-1.29a2 2 0 0 0-2.73-.9l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" />
            <span>设置</span>
          </button>
        </div>

        <div className="sidebar-foot">v0.1 · Mac 主库</div>
      </aside>

      <main className="main">
        {view === "workbench" ? (
          <WorkbenchView allItems={allItems} syncTick={syncTick} />
        ) : (
        <>
        <div className="quick-add">
          <span className="qa-plus">
            <Ico d="M12 5v14M5 12h14" />
          </span>
          <input
            ref={titleRef}
            className="qa-input"
            placeholder="添加一个想法、任务或灵感…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
          <button className="qa-btn" onClick={add}>
            添加
          </button>
        </div>

        {error && (
          <div className="error" onClick={() => setError("")}>
            {error}（点击关闭）
          </div>
        )}

        <div className="list">
          {loading && <div className="empty">加载中…</div>}
          {!loading && visible.length === 0 && (
            <div className="empty">
              还没有内容，先在上面收集一条吧。
            </div>
          )}

          {!loading &&
            visible.map((it) =>
              editingId === it.id ? (
                <div className="row editing" key={it.id}>
                  <input
                    className="edit-title"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="标题（可选）"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditingId(null);
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveEdit(it.id);
                    }}
                  />
                  <textarea
                    className="edit-content"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    placeholder="写点什么…"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") { e.preventDefault(); setEditingId(null); }
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveEdit(it.id);
                    }}
                  />
                  <div className="edit-row">
                    <span className="edit-hint">⌘↵ 保存 · Esc 取消</span>
                    <div className="edit-row-right">
                      <button
                        className="icon-btn danger"
                        onClick={() => { setEditingId(null); remove(it.id); }}
                        title="删除"
                        aria-label="删除"
                      >
                        <Ico d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      </button>
                      <button className="btn primary" onClick={() => saveEdit(it.id)}>完成</button>
                    </div>
                  </div>
                </div>
              ) : it.item_type === "note" ? (
                <div className="note-card" key={it.id} onDoubleClick={() => startEdit(it)}>
                  <div className="note-body">
                    {it.title && <div className="note-title">{it.title}</div>}
                    {it.content && <div className="note-text">{it.content}</div>}
                  </div>
                  <div className="note-foot">
                    {it.source === "mobile" && (
                      <span className="tag source">手机</span>
                    )}
                    <span className="tag time">{fmtTime(it.created_at)}</span>
                    <div className="row-actions">
                      <button className="act" onClick={() => process(it.id, "task")}>
                        → 任务
                      </button>
                      <button
                        className="icon-btn danger"
                        onClick={() => remove(it.id)}
                        title="删除"
                        aria-label="删除"
                      >
                        <Ico d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className={`task-row status-${it.status}`}
                  key={it.id}
                  onDoubleClick={() => startEdit(it)}
                >
                  <button
                    className="check"
                    onClick={() => toggleStatus(it)}
                    aria-label="切换完成"
                  >
                    {it.status === "done" && <CheckMark white />}
                  </button>

                  <div className="task-main">
                    <div className="task-title">
                      {it.title}
                      {it.content && <span className="task-sub">{it.content}</span>}
                    </div>
                    <div className="task-tags">
                      {it.status !== "open" && (
                        <span className="tag status">{STATUS_LABELS[it.status]}</span>
                      )}
                      {it.source === "mobile" && (
                        <span className="tag source">手机</span>
                      )}
                      <span className="tag time">{fmtTime(it.created_at)}</span>
                    </div>
                  </div>

                  <div className="row-actions">
                    <button className="act" onClick={() => process(it.id, "note")}>
                      → 笔记
                    </button>
                    <button
                      className="icon-btn danger"
                      onClick={() => remove(it.id)}
                      title="删除"
                      aria-label="删除"
                    >
                      <Ico d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    </button>
                  </div>
                </div>
              )
            )}
        </div>
        </>
        )}
      </main>
      </>)}
    </div>
  );
}

export default App;

// ===== 工作台（启动器）=====
const KIND_ICONS: Record<LauncherKind, string> = {
  web: "🌐",
  obsidian: "📓",
  app: "📦",
  folder: "📁",
};

function placeholderFor(kind: LauncherKind): string {
  switch (kind) {
    case "web":
      return "https://example.com";
    case "obsidian":
      return "vault 名称（如 MyVault）";
    case "app":
      return "/Applications/X.app 或 应用名";
    case "folder":
      return "/path/to/folder";
  }
}

function WorkbenchView({ allItems, syncTick }: { allItems: InboxItem[]; syncTick: number }) {
  const [data, setData] = useState<WorkbenchData>({ groups: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [fName, setFName] = useState("");
  const [fKind, setFKind] = useState<LauncherKind>("web");
  const [fTarget, setFTarget] = useState("");
  const [fIcon, setFIcon] = useState("");
  const [fGroup, setFGroup] = useState("");
  const [fNewGroup, setFNewGroup] = useState("");

  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState("");

  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setData(await getWorkbench());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 跨设备同步到达（syncTick 变化）→ 重新拉取工作台配置
  useEffect(() => {
    if (syncTick > 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncTick]);

  const persist = async (next: WorkbenchData) => {
    await saveWorkbench(next);
    setData(next);
  };

  const openItem = (it: LauncherItem) => {
    openLauncher(it.kind, it.target).catch((e) => setError(String(e)));
  };

  const resetForm = () => {
    setFName("");
    setFTarget("");
    setFIcon("");
    setFGroup("");
    setFNewGroup("");
    setFKind("web");
    setEditingId(null);
  };

  const openForm = (it?: LauncherItem) => {
    if (it) {
      setEditingId(it.id);
      setFName(it.name);
      setFKind(it.kind);
      setFTarget(it.target);
      setFIcon(it.icon);
      setFGroup(it.group_id);
    } else {
      resetForm();
    }
    setShowForm(true);
  };

  const submit = async () => {
    const name = fName.trim();
    const target = fTarget.trim();
    if (!name) {
      setError("请填写名称");
      return;
    }
    if (!target) {
      setError("请填写目标（链接 / 路径 / vault 名）");
      return;
    }
    let groups = [...data.groups];
    let groupId = fGroup;
    const ng = fNewGroup.trim();
    if (ng) {
      const g: LauncherGroup = { id: crypto.randomUUID(), name: ng };
      groups.push(g);
      groupId = g.id;
    }
    let items: LauncherItem[];
    if (editingId) {
      items = data.items.map((it) =>
        it.id === editingId
          ? { ...it, name, kind: fKind, target, icon: fIcon.trim(), group_id: groupId }
          : it
      );
    } else {
      const item: LauncherItem = {
        id: crypto.randomUUID(),
        name,
        kind: fKind,
        target,
        icon: fIcon.trim(),
        group_id: groupId,
      };
      items = [...data.items, item];
    }
    try {
      await persist({ groups, items });
      setShowForm(false);
      resetForm();
    } catch (e) {
      setError(String(e));
    }
  };

  const removeItem = async (id: string) => {
    if (!confirm("确定删除这个工作台项？")) return;
    try {
      await persist({
        groups: data.groups,
        items: data.items.filter((i) => i.id !== id),
      });
    } catch (e) {
      setError(String(e));
    }
  };

  const removeGroup = async (id: string, name: string) => {
    const count = data.items.filter((i) => i.group_id === id).length;
    const msg =
      count > 0
        ? `删除分组「${name}」？其下的 ${count} 个项目会移到「未分组」（不会被删除）。`
        : `删除分组「${name}」？`;
    if (!confirm(msg)) return;
    try {
      const groups = data.groups.filter((g) => g.id !== id);
      const items = data.items.map((i) =>
        i.group_id === id ? { ...i, group_id: "" } : i
      );
      await persist({ groups, items });
    } catch (e) {
      setError(String(e));
    }
  };

  const startRenameGroup = (g: LauncherGroup) => {
    setEditingGroupId(g.id);
    setGroupDraft(g.name);
  };

  const commitRenameGroup = async () => {
    if (!editingGroupId) return;
    const name = groupDraft.trim();
    const groups = data.groups.map((g) =>
      g.id === editingGroupId ? { ...g, name: name || g.name } : g
    );
    setEditingGroupId(null);
    setGroupDraft("");
    try {
      await persist({ groups, items: data.items });
    } catch (e) {
      setError(String(e));
    }
  };

  const toggleGroupCollapsed = async (id: string) => {
    const groups = data.groups.map((g) =>
      g.id === id ? { ...g, collapsed: !g.collapsed } : g
    );
    try {
      await persist({ groups, items: data.items });
    } catch (e) {
      setError(String(e));
    }
  };

  const moveGroup = async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const groups = [...data.groups];
    const fromIdx = groups.findIndex((g) => g.id === fromId);
    const toIdx = groups.findIndex((g) => g.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = groups.splice(fromIdx, 1);
    groups.splice(toIdx, 0, moved);
    try {
      await persist({ groups, items: data.items });
    } catch (e) {
      setError(String(e));
    }
  };

  const ungrouped = data.items.filter(
    (i) => !i.group_id || !data.groups.some((g) => g.id === i.group_id)
  );
  const sections = [
    ...data.groups.map((g) => ({
      key: g.id,
      groupId: g.id,
      title: g.name,
      items: data.items.filter((i) => i.group_id === g.id),
    })),
    ...(ungrouped.length
      ? [{ key: "__ungrouped", groupId: null, title: "未分组", items: ungrouped }]
      : []),
  ];

  return (
    <div className="wb-layout">
      {/* 左侧：启动器分组 */}
      <div className="wb-left">
      <div className="wb">
      <div className="wb-head">
        <div className="wb-title">工作台</div>
        <button className="btn primary" onClick={() => openForm()}>
          ＋ 添加
        </button>
      </div>

      {error && (
        <div className="error" onClick={() => setError("")}>
          {error}（点击关闭）
        </div>
      )}
      {loading && <div className="empty">加载中…</div>}
      {!loading && data.items.length === 0 && (
        <div className="empty">
          还没有工作台项，点右上角「添加」配置常用链接、应用或知识库。
        </div>
      )}

      {sections.map((s) => {
        if (s.groupId === null && s.items.length === 0) return null;
        const grp =
          s.groupId !== null
            ? data.groups.find((g) => g.id === s.groupId)
            : undefined;
        const collapsed = grp ? !!grp.collapsed : false;
        return (
          <div
            className={`wb-section${collapsed ? " collapsed" : ""}${
              dragOverGroupId === s.groupId ? " drop-target" : ""
            }`}
            key={s.key}
            onDragOver={(e) => {
              if (s.groupId !== null && dragGroupId && dragGroupId !== s.groupId) {
                e.preventDefault();
                setDragOverGroupId(s.groupId as string);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (s.groupId !== null && dragGroupId) {
                moveGroup(dragGroupId, s.groupId as string);
              }
              setDragGroupId(null);
              setDragOverGroupId(null);
            }}
          >
            <div className="wb-section-head">
              {s.groupId !== null && (
                <>
                  <span
                    className="wb-grip"
                    title="拖拽排序"
                    draggable
                    onDragStart={(e) => {
                      setDragGroupId(s.groupId as string);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragGroupId(null);
                      setDragOverGroupId(null);
                    }}
                  >
                    <svg className="wb-ico" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="6" r="1.3" /><circle cx="15" cy="6" r="1.3" />
                      <circle cx="9" cy="12" r="1.3" /><circle cx="15" cy="12" r="1.3" />
                      <circle cx="9" cy="18" r="1.3" /><circle cx="15" cy="18" r="1.3" />
                    </svg>
                  </span>
                  <button
                    className="wb-chevron"
                    title={collapsed ? "展开" : "收起"}
                    onClick={() => toggleGroupCollapsed(s.groupId as string)}
                  >
                    <svg className="wb-ico" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                </>
              )}
              {editingGroupId === s.groupId ? (
                <input
                  className="wb-section-edit"
                  value={groupDraft}
                  autoFocus
                  onChange={(e) => setGroupDraft(e.target.value)}
                  onBlur={commitRenameGroup}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRenameGroup();
                    if (e.key === "Escape") {
                      setEditingGroupId(null);
                      setGroupDraft("");
                    }
                  }}
                />
              ) : (
                <div className="wb-section-title">
                  {s.title}
                  {s.groupId !== null && collapsed && s.items.length > 0 && (
                    <span className="wb-count"> {s.items.length}</span>
                  )}
                </div>
              )}
              {s.groupId !== null && (
                <div className="wb-section-actions">
                  <button
                    className="wb-sec-edit"
                    title="重命名分组"
                    onClick={() =>
                      startRenameGroup({ id: s.groupId as string, name: s.title })
                    }
                  >
                    <svg className="wb-ico" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5ZM15 5l4 4"/>
                    </svg>
                  </button>
                  <button
                    className="wb-sec-del"
                    title="删除分组"
                    onClick={() => removeGroup(s.groupId as string, s.title)}
                  >
                    <svg className="wb-ico" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
            {collapsed ? null : s.items.length === 0 ? (
              <div className="wb-empty-group">空分组</div>
            ) : (
              <div className="wb-grid">
                {s.items.map((it) => (
                  <div
                    className="wb-card"
                    key={it.id}
                    onDoubleClick={() => openItem(it)}
                  >
                    <button
                      className={`wb-icon kind-${it.kind}`}
                      onClick={() => openItem(it)}
                      title={`打开 ${it.name}`}
                    >
                      {it.icon || KIND_ICONS[it.kind]}
                    </button>
                    <div className="wb-name" title={it.name}>
                      {it.name}
                    </div>
                    <div className="wb-actions">
                      <button
                        className="wb-edit"
                        onClick={() => openForm(it)}
                        title="编辑"
                      >
                        <svg className="wb-ico" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5ZM15 5l4 4"/>
                    </svg>
                      </button>
                      <button
                        className="wb-del"
                        onClick={() => removeItem(it.id)}
                        title="删除"
                      >
                        <svg className="wb-ico" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {showForm && (
        <div
          className="modal-overlay"
          onClick={() => {
            setShowForm(false);
            resetForm();
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              {editingId ? "编辑工作台项" : "添加工作台项"}
            </div>
            <label className="modal-field">
              <span>名称</span>
              <input
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="如：GitHub"
                autoFocus
              />
            </label>
            <label className="modal-field">
              <span>类型</span>
              <select
                value={fKind}
                onChange={(e) => setFKind(e.target.value as LauncherKind)}
              >
                <option value="web">网页链接</option>
                <option value="obsidian">Obsidian 知识库</option>
                <option value="app">本地应用</option>
                <option value="folder">文件夹</option>
              </select>
            </label>
            <label className="modal-field">
              <span>目标</span>
              <input
                value={fTarget}
                onChange={(e) => setFTarget(e.target.value)}
                placeholder={placeholderFor(fKind)}
              />
            </label>
            <label className="modal-field">
              <span>图标</span>
              <input
                value={fIcon}
                onChange={(e) => setFIcon(e.target.value)}
                placeholder="留空用默认 emoji"
              />
            </label>
            <label className="modal-field">
              <span>分组</span>
              <select value={fGroup} onChange={(e) => setFGroup(e.target.value)}>
                <option value="">未分组</option>
                {data.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="modal-field">
              <span>或新建分组</span>
              <input
                value={fNewGroup}
                onChange={(e) => setFNewGroup(e.target.value)}
                placeholder="填了就新建分组"
              />
            </label>
            <div className="modal-actions">
              <button className="btn primary" onClick={submit}>
                保存
              </button>
              <button
                className="btn"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
      </div>

      {/* 右侧：日历 + 任务 */}
      <div className="wb-right">
        <CalendarPanel tasks={allItems} />
      </div>
    </div>
  );
}

