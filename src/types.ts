export type ItemType = "note" | "task";
export type ItemStatus = "open" | "done" | "archived";
export type ItemPriority = "high" | "normal" | "low";

export interface InboxItem {
  id: string;
  item_type: ItemType;
  title: string;
  content: string;
  status: ItemStatus;
  source: string;
  obsidian_ref: string | null;
  // —— v3 各自特色字段 ——
  due_date: number | null; // 任务截止日（unix ms），笔记为 null
  priority: ItemPriority; // 任务优先级
  pinned: boolean; // 笔记置顶
  tags: string; // 笔记标签，逗号分隔
  created_at: number;
  updated_at: number;
}

// ===== 工作台（启动器）=====
export type LauncherKind = "web" | "obsidian" | "app" | "folder";

export interface LauncherItem {
  id: string;
  name: string;
  kind: LauncherKind;
  target: string;
  icon: string;
  group_id: string;
}

export interface LauncherGroup {
  id: string;
  name: string;
  collapsed?: boolean;
}

export interface WorkbenchData {
  groups: LauncherGroup[];
  items: LauncherItem[];
}
