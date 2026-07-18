import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getWorkbench, saveWorkbench, openLauncher } from "./api";
import type {
  InboxItem,
  LauncherItem,
  LauncherKind,
  LauncherGroup,
  WorkbenchData,
} from "./types";
import { ErrorBanner } from "./ErrorBanner";
import CalendarPanel from "./CalendarPanel";
import "./App.css";

const KIND_ICONS: Record<LauncherKind, string> = {
  web: "🌐",
  obsidian: "📓",
  app: "📦",
  folder: "📁",
};
const KIND_LABELS: Record<LauncherKind, string> = {
  web: "网页",
  obsidian: "知识库",
  app: "应用",
  folder: "文件夹",
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

  // 快速跳转（搜索 + 键盘导航）
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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

  // 进入工作台即聚焦跳转框，支持「输入即过滤 · 回车即打开」
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

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

  // ===== 快速跳转：搜索过滤 + 键盘导航 =====
  const q = query.trim().toLowerCase();
  const filteredSections = useMemo(() => {
    if (!q) return sections;
    const match = (it: LauncherItem) =>
      it.name.toLowerCase().includes(q) ||
      it.target.toLowerCase().includes(q) ||
      KIND_LABELS[it.kind].includes(q) ||
      (data.groups.find((g) => g.id === it.group_id)?.name || "")
        .toLowerCase()
        .includes(q);
    return sections
      .map((s) => ({ ...s, items: s.items.filter(match) }))
      .filter((s) => s.items.length > 0);
  }, [sections, q, data.groups]);

  const flat = useMemo(() => filteredSections.flatMap((s) => s.items), [filteredSections]);
  const idxOf = useMemo(() => {
    const m = new Map<string, number>();
    flat.forEach((it, i) => m.set(it.id, i));
    return m;
  }, [flat]);

  // 键盘选中的卡片滚动到可视区域
  useEffect(() => {
    const it = flat[selectedIdx];
    if (it) cardRefs.current.get(it.id)?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx, flat]);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = flat[selectedIdx];
      if (it) openItem(it);
    } else if (e.key === "Escape") {
      if (q) {
        setQuery("");
        setSelectedIdx(0);
      } else {
        (e.target as HTMLInputElement).blur();
      }
    }
  };

  return (
    <div className="wb-layout">
      {/* 左侧：启动器分组 */}
      <div className="wb-left">
      <div className="wb">
      <div className="wb-head">
        <div className="wb-title">工作台</div>
        <div className={`wb-search-wrap${searchFocused ? " focused" : ""}`}>
          <svg className="wb-search-ico" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={searchRef}
            className="wb-search"
            value={query}
            placeholder="跳转：输入名称快速打开…"
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={onSearchKey}
          />
          {query && (
            <button
              className="wb-search-clear"
              onClick={() => { setQuery(""); setSelectedIdx(0); searchRef.current?.focus(); }}
              title="清除"
              aria-label="清除"
            >
              <svg viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>
        <button className="btn primary" onClick={() => openForm()}>
          ＋ 添加
        </button>
      </div>
      {searchFocused && (
        <div className="wb-search-hint">
          输入关键词过滤 · ↑↓ 选择 · ↵ 打开 · Esc 清空
        </div>
      )}

      <ErrorBanner msg={error} onClose={() => setError("")} />
      {loading && <div className="empty">加载中…</div>}
      {!loading && data.items.length === 0 && (
        <div className="empty">
          还没有工作台项，点右上角「添加」配置常用链接、应用或知识库。
        </div>
      )}

      {filteredSections.map((s) => {
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
                    className={`wb-card${selectedIdx === (idxOf.get(it.id) ?? -1) ? " selected" : ""}`}
                    key={it.id}
                    ref={(el) => {
                      if (el) cardRefs.current.set(it.id, el);
                      else cardRefs.current.delete(it.id);
                    }}
                    onClick={() => openItem(it)}
                    title={`打开 ${it.name}`}
                  >
                    <div className={`wb-icon kind-${it.kind}`}>
                      {it.icon || KIND_ICONS[it.kind]}
                    </div>
                    <div className="wb-name" title={it.name}>
                      {it.name}
                    </div>
                    <div className="wb-actions">
                      <button
                        className="wb-edit"
                        onClick={(e) => { e.stopPropagation(); openForm(it); }}
                        title="编辑"
                      >
                        <svg className="wb-ico" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5ZM15 5l4 4"/>
                    </svg>
                      </button>
                      <button
                        className="wb-del"
                        onClick={(e) => { e.stopPropagation(); removeItem(it.id); }}
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

      {query.trim() && flat.length === 0 && (
        <div className="wb-no-results">
          没有匹配「{query.trim()}」的跳转项
        </div>
      )}

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

export default WorkbenchView;
