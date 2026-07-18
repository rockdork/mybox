import type * as React from "react";
import { useEffect, useMemo, useState } from "react";
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

// 类型图标（lucide 线性图标，统一描边风格；设计规范要求图标库锁定 lucide）
const KIND_ICON_PATHS: Record<LauncherKind, React.ReactNode> = {
  web: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </>
  ),
  obsidian: (
    <>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-5a4 4 0 0 0-4 4 4 4 0 0 0-4-4z" />
    </>
  ),
  app: (
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  folder: (
    <>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </>
  ),
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
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<LauncherKind | "">("");

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
      const existing = groups.find(
        (g) => g.name.trim().toLowerCase() === ng.toLowerCase()
      );
      if (existing) {
        groupId = existing.id; // 分组名已存在 → 复用，避免重复
      } else {
        const g: LauncherGroup = { id: crypto.randomUUID(), name: ng };
        groups.push(g);
        groupId = g.id;
      }
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
        ? `删除工作区「${name}」？其下的 ${count} 个项目会移到「默认工作区」（不会被删除）。`
        : `删除工作区「${name}」？`;
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
    if (!name) {
      setEditingGroupId(null);
      setGroupDraft("");
      return;
    }
    const dup = data.groups.find(
      (g) => g.id !== editingGroupId && g.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (dup) {
      setError(`分组名「${name}」已存在，请换一个`);
      setEditingGroupId(null);
      setGroupDraft("");
      return;
    }
    const groups = data.groups.map((g) =>
      g.id === editingGroupId ? { ...g, name } : g
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

  const moveItemToGroup = async (itemId: string, groupId: string | null) => {
    const items = data.items.map((i) =>
      i.id === itemId ? { ...i, group_id: groupId ?? "" } : i
    );
    try {
      await persist({ groups: data.groups, items });
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
    { key: "__ungrouped", groupId: null, title: "默认工作区", items: ungrouped },
  ];

  // ===== 类型筛选（按 launcher 类型收窄，与分组并列） =====
  const filteredSections = useMemo(() => {
    if (!kindFilter) return sections;
    return sections
      .map((s) => ({ ...s, items: s.items.filter((it) => it.kind === kindFilter) }))
      .filter((s) => s.items.length > 0);
  }, [sections, kindFilter, data.groups]);

  const flat = useMemo(() => filteredSections.flatMap((s) => s.items), [filteredSections]);

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

      {/* 类型筛选 chips：按 launcher 类型收窄 */}
      <div className="wb-filters" role="tablist" aria-label="按类型筛选">
        {(["", "web", "obsidian", "app", "folder"] as const).map((k) => (
          <button
            key={k || "all"}
            type="button"
            role="tab"
            aria-selected={kindFilter === k}
            className={`wb-chip${kindFilter === k ? " active" : ""}`}
            onClick={() => setKindFilter(k)}
          >
            {k === "" ? "全部" : KIND_LABELS[k]}
          </button>
        ))}
      </div>

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
              const canDrop =
                dragItemId ||
                (s.groupId !== null && dragGroupId && dragGroupId !== s.groupId);
              if (canDrop) {
                e.preventDefault();
                setDragOverGroupId(s.groupId as string);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragItemId) {
                moveItemToGroup(dragItemId, s.groupId);
              } else if (s.groupId !== null && dragGroupId) {
                moveGroup(dragGroupId, s.groupId as string);
              }
              setDragItemId(null);
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
                  {s.groupId !== null && (
                    <button
                      className="wb-chevron-inline"
                      title={collapsed ? "展开" : "收起"}
                      onClick={() => toggleGroupCollapsed(s.groupId as string)}
                    >
                      <svg viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                        style={{
                          width: 14,
                          height: 14,
                          transition: 'transform var(--dur-fast) var(--ease)',
                          transform: collapsed ? 'rotate(-90deg)' : undefined,
                        }}>
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </button>
                  )}
                  {collapsed && s.items.length > 0 && (
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
                    className={`wb-card${dragItemId === it.id ? " dragging" : ""}`}
                    key={it.id}
                    draggable
                    onDragStart={(e) => {
                      setDragItemId(it.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragItemId(null);
                      setDragOverGroupId(null);
                    }}
                    onClick={() => openItem(it)}
                    title={`打开 ${it.name}（拖拽可移动分组）`}
                  >
                    <div className={`wb-icon kind-${it.kind}`}>
                      {it.icon ? (
                        <span className="wb-icon-custom">{it.icon}</span>
                      ) : (
                        <svg
                          className="wb-kind-ico"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          {KIND_ICON_PATHS[it.kind]}
                        </svg>
                      )}
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

      {kindFilter && flat.length === 0 && (
        <div className="wb-no-results">
          没有「{KIND_LABELS[kindFilter]}」类型的跳转项
        </div>
      )}

      {showForm && (
        <div
          className="wb-modal-overlay"
          onClick={() => {
            setShowForm(false);
            resetForm();
          }}
        >
          <div className="wb-modal" onClick={(e) => e.stopPropagation()}>
            {/* 标题栏：左文字 + 右关闭 */}
            <div className="wb-modal-header">
              <span className="wb-modal-title">
                {editingId ? "编辑项" : "添加跳转"}
              </span>
              <button
                className="wb-modal-close"
                onClick={() => { setShowForm(false); resetForm(); }}
                aria-label="关闭"
                title="关闭"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            {/* 主区：名称 + 目标 + 类型 pills */}
            <div className="wb-modal-body">
              <label className="wb-field">
                <span className="wb-label">名称</span>
                <input
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                  placeholder="如：GitHub"
                  autoFocus
                />
              </label>
              <label className="wb-field">
                <span className="wb-label">目标</span>
                <input
                  value={fTarget}
                  onChange={(e) => setFTarget(e.target.value)}
                  placeholder={placeholderFor(fKind)}
                />
              </label>

              {/* 类型：pill 选择器（替代丑下拉框） */}
              <div className="wb-field">
                <span className="wb-label">类型</span>
                <div className="wb-kind-pills" role="radiogroup">
                  {(["web", "obsidian", "app", "folder"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={fKind === k}
                      className={`wb-kind-pill${fKind === k ? " active" : ""}`}
                      onClick={() => setFKind(k)}
                    >
                      {KIND_LABELS[k]}
                    </button>
                  ))}
                </div>
              </div>

              {/* 分组：单行智能输入（选已有 或 输入新名） */}
              <label className="wb-field">
                <span className="wb-label">工作区</span>
                <div className="wb-group-row">
                  {data.groups.length > 0 ? (
                    <>
                      <select value={fGroup} onChange={(e) => setFGroup(e.target.value)} className="wb-group-select">
                        <option value="">默认工作区</option>
                        {data.groups.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                      <span className="wb-group-or">或</span>
                    </>
                  ) : null}
                  <input
                    value={fNewGroup}
                    onChange={(e) => setFNewGroup(e.target.value)}
                    placeholder={data.groups.length > 0 ? "新工作区名…" : "工作区名…"}
                    className={data.groups.length > 0 ? "wb-group-new" : ""}
                  />
                </div>
              </label>

              {/* 图标：收起到底部次要区 */}
              <label className="wb-field wb-field-weak">
                <span className="wb-label">图标 <em>(可选)</em></span>
                <input
                  value={fIcon}
                  onChange={(e) => setFIcon(e.target.value)}
                  placeholder="留空使用类型默认图标"
                />
              </label>
            </div>

            {/* 底部操作栏 */}
            <div className="wb-modal-footer">
              <button className="btn btn-text" onClick={() => { setShowForm(false); resetForm(); }}>
                取消
              </button>
              <button className="btn btn-primary-lg" onClick={submit}>
                保存
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
