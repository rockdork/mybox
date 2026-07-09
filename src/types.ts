export type ItemType = "note" | "task";
export type ItemStatus = "open" | "done" | "archived";

export interface InboxItem {
  id: string;
  item_type: ItemType;
  title: string;
  content: string;
  status: ItemStatus;
  source: string;
  obsidian_ref: string | null;
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
