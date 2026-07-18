import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  createItem,
  listItems,
  updateItem,
  deleteItem,
  getSettings,
  setDataDir,
  openDataDir,
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
  ItemPriority,
} from "./types";
import WorkbenchView from "./WorkbenchView";
import Sidebar, { type View } from "./Sidebar";
import { ErrorBanner } from "./ErrorBanner";
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

// yyyy-mm-dd（本地）↔ unix ms
function toDateInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// 任务截止日徽标：逾期 / 今日 / 明日 / M月D日 周X
function fmtDue(ms: number | null): string {
  if (ms == null) return "无截止";
  const d = new Date(ms);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  if (d < today) return "逾期";
  if (d >= today && d < tomorrow) return "今日";
  if (d >= tomorrow && d < new Date(today.getTime() + 86400000 * 2)) return "明日";
  const wds = ["日", "一", "二", "三", "四", "五", "六"];
  return `${d.getMonth() + 1}/${d.getDate()} 周${wds[d.getDay()]}`;
}

// 是否逾期（截止日 < 今天 00:00）
function dueOverdue(ms: number): boolean {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return ms < today;
}

/* ── 任务时间分组（逾期 / 今日 / 明日 / 7天内 / 更远 / 已完成）── */
const TASK_GROUPS = [
  { key: "overdue", label: "逾期" },
  { key: "today", label: "今日" },
  { key: "tomorrow", label: "明日" },
  { key: "week", label: "7 天内" },
  { key: "later", label: "更远" },
  { key: "done", label: "已完成" },
] as const;

type TaskGroupKey = (typeof TASK_GROUPS)[number]["key"];

function getTaskGroupKey(due: number | null, status: ItemStatus): TaskGroupKey {
  if (status === "done") return "done";
  if (due == null) return "later"; // 无截止日 → 更远

  const d = new Date(due);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const weekEnd = new Date(today.getTime() + 86400000 * 7);

  if (d < today) return "overdue";
  if (d >= today && d < tomorrow) return "today";
  if (d >= tomorrow && d < weekEnd) return "week";
  return "later";
}

function groupTasksByTime(items: InboxItem[]) {
  const groups: Partial<Record<TaskGroupKey, InboxItem[]>> = {};
  for (const g of TASK_GROUPS) groups[g.key] = [];
  for (const it of items) {
    const k = getTaskGroupKey(it.due_date, it.status);
    (groups[k] ??= []).push(it);
  }
  // 仅显示非空分组
  return TASK_GROUPS.filter((g) => (groups[g.key]?.length ?? 0) > 0).map((g) => ({
    ...g,
    items: groups[g.key] ?? [],
  }));
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

const PinIco = () => (
  <svg
    className="ico pin-ico"
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
  >
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

const TRASH =
  "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6";
const STAR =
  "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";

function App() {
  const [allItems, setAllItems] = useState<InboxItem[]>([]);
  const [filter, setFilter] = useState<Filter>("note");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  // 任务快捷添加的状态
  const [taskDue, setTaskDue] = useState("");
  const [taskPriority, setTaskPriority] = useState<ItemPriority>("normal");
  // 笔记快捷添加的状态
  const [notePinned, setNotePinned] = useState(false);
  const [noteTags, setNoteTags] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editStatus, setEditStatus] = useState<ItemStatus>("open");
  const [editType, setEditType] = useState<ItemType>("note");
  const [editDue, setEditDue] = useState("");
  const [editPriority, setEditPriority] = useState<ItemPriority>("normal");
  const [editPinned, setEditPinned] = useState(false);
  const [editTags, setEditTags] = useState("");

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [moving, setMoving] = useState(false);
  const [view, setView] = useState<View>("workbench");
  const [collapsed, setCollapsed] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [resizing, setResizing] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [taskCollapsed, setTaskCollapsed] = useState<Record<string, boolean>>({});

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

  // ===== 应用内更新检查（GitHub Releases，无需 Apple 签名）=====
  const GITHUB_REPO = "rockdork/mybox";
  const [appVersion, setAppVersion] = useState("0.1.0");
  const appVersionRef = useRef("0.1.0");
  const [updateInfo, setUpdateInfo] = useState<{
    status: "idle" | "checking" | "latest" | "available" | "error";
    latest?: string;
    url?: string;
    publishedAt?: string;
    error?: string;
  }>({ status: "idle" });

  // 语义化版本比较：a>b 返回 1，相等 0，a<b -1
  const compareVer = (a: string, b: string): number => {
    const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
    const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };

  const checkUpdate = async () => {
    setUpdateInfo((p) => ({ ...p, status: "checking" }));
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
        { headers: { Accept: "application/vnd.github+json" } },
      );
      if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`);
      const data = await res.json();
      const latest = String(data.tag_name ?? "").replace(/^v/i, "");
      const cur = appVersionRef.current.replace(/^v/i, "");
      const isNewer = latest !== "" && compareVer(latest, cur) > 0;
      setUpdateInfo({
        status: isNewer ? "available" : "latest",
        latest,
        url:
          data.html_url ?? `https://github.com/${GITHUB_REPO}/releases`,
        publishedAt: data.published_at,
      });
    } catch (e) {
      setUpdateInfo({ status: "error", error: String(e) });
    }
  };

  // 启动后读取真实版本号并自动检查一次更新
  useEffect(() => {
    getVersion()
      .then((v) => {
        appVersionRef.current = v;
        setAppVersion(v);
      })
      .catch(() => {})
      .finally(() => {
        checkUpdate();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // 侧栏拖拽调整宽度
  const SIDEBAR_MIN = 180;
  const SIDEBAR_MAX = 420;
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startWidth = collapsed ? 68 : sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      if (collapsed) {
        // 从收起状态拖出 → 自动展开到合理宽度
        const newW = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, 68 + delta));
        setSidebarWidth(newW);
        if (delta > 10 && collapsed) setCollapsed(false);
      } else {
        setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startWidth + delta)));
      }
    };

    const onMouseUp = () => {
      setResizing(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      // 拖拽结束时如果太窄就收起
      if (!collapsed && sidebarWidth < SIDEBAR_MIN + 20) {
        toggleSidebar();
      }
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

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
    const list = allItems.filter((i) => i.item_type === filter);
    if (filter === "note") {
      // 置顶项排在最前，其余保持原顺序
      return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned));
    }
    return list;
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
    if (filter === "task") {
      const t = title.trim();
      if (!t) {
        titleRef.current?.focus();
        return;
      }
      mutate(async () => {
        const due = taskDue ? new Date(taskDue + "T23:59:59").getTime() : null;
        await createItem(t, content.trim(), "task", "desktop", due, taskPriority, false, "");
        setTitle("");
        setContent("");
        setTaskDue("");
        setTaskPriority("normal");
        titleRef.current?.focus();
      });
    } else {
      const t = title.trim();
      const c = content.trim();
      if (!t && !c) {
        contentRef.current?.focus();
        return;
      }
      mutate(async () => {
        await createItem(t, c, "note", "desktop", null, "normal", notePinned, noteTags);
        setTitle("");
        setContent("");
        setNotePinned(false);
        setNoteTags("");
        contentRef.current?.focus();
      });
    }
  };

  const remove = (id: string) => {
    if (!confirm("确定删除这条？")) return;
    mutate(() => deleteItem(id));
  };



  const toggleStatus = (it: InboxItem) => {
    const next: ItemStatus = it.status === "done" ? "open" : "done";
    mutate(() =>
      updateItem(it.id, it.title, it.content, next, it.item_type, it.due_date, it.priority, it.pinned, it.tags)
    );
  };

  const startEdit = (it: InboxItem) => {
    setEditingId(it.id);
    setEditTitle(it.title);
    setEditContent(it.content);
    setEditStatus(it.status);
    setEditType(it.item_type);
    setEditDue(it.due_date ? toDateInput(it.due_date) : "");
    setEditPriority(it.priority);
    setEditPinned(it.pinned);
    setEditTags(it.tags);
  };

  const saveEdit = (id: string) => {
    mutate(async () => {
      const due = editDue ? new Date(editDue + "T23:59:59").getTime() : null;
      await updateItem(
        id,
        editTitle.trim(),
        editContent.trim(),
        editStatus,
        editType,
        due,
        editPriority,
        editPinned,
        editTags,
      );
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
                <div className="settings-card-title">更新</div>
                <div className="settings-card-desc">
                  自动检查 GitHub 上的新版本，发现后可一键前往下载。
                </div>
              </div>
              <div className="settings-about-row">
                <span>当前版本</span>
                <span>v{appVersion}</span>
              </div>
              <div className="update-state">
                {updateInfo.status === "checking" && (
                  <span className="up-checking">检查中…</span>
                )}
                {updateInfo.status === "latest" && (
                  <span className="up-ok">已是最新（v{updateInfo.latest}）</span>
                )}
                {updateInfo.status === "available" && (
                  <span className="up-avail">
                    发现新版本 v{updateInfo.latest}
                    {updateInfo.publishedAt
                      ? ` · ${new Date(updateInfo.publishedAt).toLocaleDateString("zh-CN")}`
                      : ""}
                  </span>
                )}
                {updateInfo.status === "error" && (
                  <span className="up-err">检查失败：{updateInfo.error}</span>
                )}
              </div>
              <div className="settings-actions">
                <button
                  className="btn sm"
                  onClick={checkUpdate}
                  disabled={updateInfo.status === "checking"}
                >
                  检查更新
                </button>
                {updateInfo.status === "available" && updateInfo.url && (
                  <button
                    className="btn sm primary"
                    onClick={() => openUrl(updateInfo.url!)}
                  >
                    前往下载
                  </button>
                )}
              </div>
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
                  <span>v{appVersion} · Mac 主库</span>
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
          <Sidebar
            collapsed={collapsed}
            view={view}
            filter={filter}
            counts={counts}
            showAddMenu={showAddMenu}
            setShowAddMenu={setShowAddMenu}
            onToggleSidebar={toggleSidebar}
            onNavClick={(f) => { setView("main"); setFilter(f); }}
            onWorkbenchClick={() => setView("workbench")}
            onSettingsClick={() => setView("settings")}
            onAddNote={() => { setView("main"); setFilter("note"); setTimeout(() => titleRef.current?.focus(), 0); }}
            onAddTask={() => { setView("main"); setFilter("task"); setTimeout(() => titleRef.current?.focus(), 0); }}
            style={{ width: collapsed ? 68 : sidebarWidth, flexShrink: 0 }}
          />

          {/* 侧栏拖拽分割条 */}
          {!collapsed && (
            <div
              className={`sidebar-resize${resizing ? " active" : ""}`}
              onMouseDown={startResize}
              onDoubleClick={toggleSidebar}
              title="拖拽调整宽度，双击收起"
            />
          )}

          <main className={`main${filter === "task" && view === "main" ? " task-main" : ""}`}>
            {view === "workbench" ? (
              <WorkbenchView allItems={allItems} syncTick={syncTick} />
            ) : filter === "task" ? (
              <div className="task-layout">
                <div className="task-list-pane">
                  <div className="quick-add task-quick">
                    <span className="qa-plus"><Ico d="M12 5v14M5 12h14" /></span>
                    <input
                      ref={titleRef}
                      className="qa-input"
                      placeholder="添加一个任务…"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                    />
                    <div className="qa-extra">
                      <input
                        type="date"
                        className="qa-date"
                        value={taskDue}
                        onChange={(e) => setTaskDue(e.target.value)}
                        title="截止日期"
                      />
                      <select
                        className="qa-pri"
                        value={taskPriority}
                        onChange={(e) => setTaskPriority(e.target.value as ItemPriority)}
                        title="优先级"
                      >
                        <option value="high">高</option>
                        <option value="normal">中</option>
                        <option value="low">低</option>
                      </select>
                      <button className="qa-btn" onClick={add}>添加</button>
                    </div>
                  </div>

                  <ErrorBanner msg={error} onClose={() => setError("")} />

                  {loading && <div className="empty">加载中…</div>}
                  {!loading && visible.length === 0 && (
                    <div className="empty">还没有任务，先在上面添加一条吧。</div>
                  )}

                  {!loading && groupTasksByTime(visible).map((grp) => {
                    const isCollapsed =
                      grp.key === "done"
                        ? taskCollapsed[grp.key] !== false
                        : !!taskCollapsed[grp.key];
                    return (
                      <div className={`tg-section${isCollapsed ? " collapsed" : ""}`} key={grp.key} data-g={grp.key}>
                        <div
                          className="tg-head"
                          onClick={() => setTaskCollapsed((p) => ({ ...p, [grp.key]: !p[grp.key] }))}
                        >
                          <span className="tg-dot" />
                          <span className="tg-title">{grp.label}</span>
                          <span className="tg-count">{grp.items.length}</span>
                          <button
                            className="tg-chevron"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTaskCollapsed((p) => ({ ...p, [grp.key]: !p[grp.key] }));
                            }}
                          >
                            <Ico d="M9 6l6 6-6 6" />
                          </button>
                        </div>
                        {!isCollapsed && (
                          <div className="tg-body">
                            {grp.items.map((it) =>
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
                                  <div className="edit-extra">
                                    {editType === "task" && (
                                      <>
                                        <label className="edit-field">
                                          <span>截止</span>
                                          <input
                                            type="date"
                                            value={editDue}
                                            onChange={(e) => setEditDue(e.target.value)}
                                          />
                                        </label>
                                        <label className="edit-field">
                                          <span>优先级</span>
                                          <select
                                            value={editPriority}
                                            onChange={(e) => setEditPriority(e.target.value as ItemPriority)}
                                          >
                                            <option value="high">高</option>
                                            <option value="normal">中</option>
                                            <option value="low">低</option>
                                          </select>
                                        </label>
                                      </>
                                    )}
                                    {editType === "note" && (
                                      <>
                                        <input
                                          className="edit-tags"
                                          placeholder="标签"
                                          value={editTags}
                                          onChange={(e) => setEditTags(e.target.value)}
                                        />
                                        <label className="edit-pin">
                                          <input
                                            type="checkbox"
                                            checked={editPinned}
                                            onChange={(e) => setEditPinned(e.target.checked)}
                                          />
                                          <span>置顶</span>
                                        </label>
                                      </>
                                    )}
                                  </div>
                                  <div className="edit-row">
                                    <span className="edit-hint">⌘↵ 保存 · Esc 取消</span>
                                    <div className="edit-row-right">
                                      <button
                                        className="icon-btn danger"
                                        onClick={() => { setEditingId(null); remove(it.id); }}
                                        title="删除"
                                        aria-label="删除"
                                      >
                                        <Ico d={TRASH} />
                                      </button>
                                      <button className="btn primary" onClick={() => saveEdit(it.id)}>完成</button>
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

                                  <div className="task-body">
                                    <div className="task-top">
                                      <span className="task-name">{it.title}</span>
                                      {it.priority === "high" && (
                                        <span className="tag pri-high"><Ico d={STAR} /> 高</span>
                                      )}
                                      {it.priority === "low" && (
                                        <span className="tag pri-low">低</span>
                                      )}
                                      {it.source === "mobile" && (
                                        <span className="tag src">手机</span>
                                      )}
                                      {it.status !== "open" && (
                                        <span className="tag st">{STATUS_LABELS[it.status]}</span>
                                      )}
                                    </div>
                                    {it.content && <div className="task-desc">{it.content}</div>}
                                  </div>

                                  <div className="task-meta">
                                    {it.due_date ? (
                                      <span className={`task-time${dueOverdue(it.due_date) ? " overdue" : ""}`}>{fmtDue(it.due_date)}</span>
                                    ) : (
                                      <span className="task-time muted">{fmtTime(it.created_at)}</span>
                                    )}
                                    <div className="task-acts">
                                      <button
                                        className="icon-btn danger"
                                        onClick={() => remove(it.id)}
                                        title="删除"
                                        aria-label="删除"
                                      >
                                        <Ico d={TRASH} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="task-cal-pane">
                  <CalendarPanel tasks={allItems} />
                </div>
              </div>

        ) : (
        <>
        <div className="note-quick">
          <textarea
            ref={contentRef}
            className="nq-input"
            placeholder="写一条笔记…（⌘↵ 添加）"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") add();
            }}
          />
          <div className="nq-row">
            <input
              className="nq-tags"
              placeholder="标签，用空格分隔"
              value={noteTags}
              onChange={(e) => setNoteTags(e.target.value)}
            />
            <label className="nq-pin">
              <input
                type="checkbox"
                checked={notePinned}
                onChange={(e) => setNotePinned(e.target.checked)}
              />
              <span>置顶</span>
            </label>
            <button className="qa-btn" onClick={add}>添加</button>
          </div>
        </div>

        <ErrorBanner msg={error} onClose={() => setError("")} />

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
                        <Ico d={TRASH} />
                      </button>
                      <button className="btn primary" onClick={() => saveEdit(it.id)}>完成</button>
                    </div>
                  </div>
                </div>
              ) : it.item_type === "note" ? (
                <div className={`note-card${it.pinned ? " pinned" : ""}`} key={it.id} onDoubleClick={() => startEdit(it)}>
                  <div className="note-body">
                    {it.pinned && <span className="note-pin"><PinIco /></span>}
                    {it.title && <div className="note-title">{it.title}</div>}
                    {it.content && <div className="note-text">{it.content}</div>}
                  </div>
                  <div className="note-foot">
                    {it.tags && <span className="tag note-tag">{it.tags}</span>}
                    {it.source === "mobile" && (
                      <span className="tag source">手机</span>
                    )}
                    <span className="tag time">{fmtTime(it.created_at)}</span>
                    <div className="row-actions">
                      <button
                        className="icon-btn danger"
                        onClick={() => remove(it.id)}
                        title="删除"
                        aria-label="删除"
                      >
                        <Ico d={TRASH} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : null
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
