import type { ItemType } from "./types";
import { useEffect, useRef } from "react";
import "./App.css";

export type View = "main" | "workbench" | "settings";
export type Filter = ItemType;

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

interface SidebarProps {
  collapsed: boolean;
  view: View;
  filter: Filter;
  counts: Record<ItemType, number>;
  showAddMenu: boolean;
  setShowAddMenu: (v: boolean | ((p: boolean) => boolean)) => void;
  onNavClick: (f: Filter) => void;
  onWorkbenchClick: () => void;
  onSettingsClick: () => void;
  onAddNote: () => void;
  onAddTask: () => void;
  onAddLauncher?: () => void;
  style?: React.CSSProperties;
}

export default function Sidebar({
  collapsed,
  view,
  filter,
  counts,
  showAddMenu,
  setShowAddMenu,
  onNavClick,
  onWorkbenchClick,
  onSettingsClick,
  onAddNote,
  onAddTask,
  onAddLauncher,
  style,
}: SidebarProps) {
  const addRef = useRef<HTMLDivElement>(null);

  // 点击浮窗外区域关闭
  useEffect(() => {
    if (!showAddMenu) return;
    const handler = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    // 用 mousedown（比 click 更快响应，避免穿透）
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAddMenu, setShowAddMenu]);

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`} style={style}>
      {/* 品牌区：永远收起，顶部展示 inbox 图标 */}
      <div className="brand">
        <div className="brand-mark" title="mybox">
          <svg
            className="brand-ico"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* inbox / 收集箱字形：开口盒 + 翻盖 */}
            <path d="M5 10h14a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1v-7a1 1 0 011-1z" />
            <path d="M5 10l7-5 7 5" />
            <line x1="12" y1="5" x2="12" y2="10" />
          </svg>
        </div>
      </div>

      {/* 添加按钮 */}
      <div className="sidebar-add" ref={addRef}>
        <button
          className="add-btn"
          onClick={() => setShowAddMenu((v) => !v)}
          title="添加"
        >
          <Ico d="M12 5v14M5 12h14" />
        </button>
        {showAddMenu && (
          <div className="add-menu">
            {onAddLauncher && (
              <button
                className="add-opt"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setShowAddMenu(false);
                  onAddLauncher();
                }}
              >
                <Ico d="M7 7h10v10 M7 17 17 7" />
                添加跳转
              </button>
            )}
            <button
              className="add-opt"
              onMouseDown={(e) => {
                e.preventDefault();
                setShowAddMenu(false);
                onAddNote();
              }}
            >
              <Ico d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6" />
              添加笔记
            </button>
            <button
              className="add-opt"
              onMouseDown={(e) => {
                e.preventDefault();
                setShowAddMenu(false);
                onAddTask();
              }}
            >
              <Ico d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
              添加任务
            </button>
          </div>
        )}
      </div>

      {/* 导航 */}
      <nav className="nav">
        <button
          className={`nav-item ${view === "workbench" ? "active" : ""}`}
          onClick={onWorkbenchClick}
          title="工作台"
        >
          <Ico d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
          <span className="nav-label">工作台</span>
        </button>
        {NAV.map((f) => (
          <button
            key={f.key}
            className={`nav-item ${filter === f.key && view === "main" ? "active" : ""}`}
            onClick={() => onNavClick(f.key)}
            title={f.label}
          >
            <Ico d={f.d} />
            <span className="nav-label">{f.label}</span>
            <span className="nav-count">{counts[f.key]}</span>
          </button>
        ))}
      </nav>

      {/* 底部 */}
      <div className="sidebar-bottom">
        <button className="settings-btn" onClick={onSettingsClick}>
          <Ico d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.91L3.27 8.04a2 2 0 0 0 .9 2.73l.15.09a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.9 2.73l.73 1.29a2 2 0 0 0 2.73.9l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.9l.73-1.29a2 2 0 0 0-.9-2.73l-.15-.09a2 2 0 0 1-1-1.74V12.6a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .9-2.73l-.73-1.29a2 2 0 0 0-2.73-.9l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" />
          <span>设置</span>
        </button>
      </div>

      <div className="sidebar-foot">v0.1 · Mac 主库</div>
    </aside>
  );
}
