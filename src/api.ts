import { invoke } from "@tauri-apps/api/core";
import type {
  InboxItem,
  ItemType,
  ItemStatus,
  ItemPriority,
  WorkbenchData,
  LauncherKind,
} from "./types";

// Tauri v2 invoke 约定：Rust 侧 snake_case → JS 侧 camelCase
// 例如 Rust `item_type` 对应 JS `targetType`
export function createItem(
  title: string,
  content = "",
  item_type: ItemType = "note",
  source = "desktop",
  due_date: number | null = null,
  priority: ItemPriority = "normal",
  pinned = false,
  tags = ""
): Promise<InboxItem> {
  return invoke<InboxItem>("create_inbox_item", {
    title,
    content,
    itemType: item_type,
    source,
    dueDate: due_date,
    priority,
    pinned,
    tags,
  });
}

export function listItems(filter_type: ItemType | null = null): Promise<InboxItem[]> {
  return invoke<InboxItem[]>("list_inbox_items", { filterType: filter_type });
}

export function updateItem(
  id: string,
  title: string,
  content: string,
  status: ItemStatus,
  item_type: ItemType,
  due_date: number | null = null,
  priority: ItemPriority = "normal",
  pinned = false,
  tags = ""
): Promise<InboxItem> {
  return invoke<InboxItem>("update_inbox_item", {
    id,
    title,
    content,
    status,
    itemType: item_type,
    dueDate: due_date,
    priority,
    pinned,
    tags,
  });
}

export function deleteItem(id: string): Promise<void> {
  return invoke<void>("delete_inbox_item", { id });
}

export function processItem(
  id: string,
  target_type: ItemType,
  status: ItemStatus | null = null
): Promise<InboxItem> {
  return invoke<InboxItem>("process_inbox_item", { id, targetType: target_type, status });
}

export interface AppSettings {
  dataDir: string | null;
  defaultDir: string;
  currentDb: string;
}

export function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

export function setDataDir(newDir: string): Promise<void> {
  return invoke<void>("set_data_dir", { newDir });
}

export function openDataDir(): Promise<void> {
  return invoke<void>("open_data_dir");
}

// ===== 工作台（启动器）=====
export function getWorkbench(): Promise<WorkbenchData> {
  return invoke<WorkbenchData>("get_workbench");
}

export function saveWorkbench(data: WorkbenchData): Promise<void> {
  return invoke<void>("save_workbench", { data });
}

export function openLauncher(kind: LauncherKind, target: string): Promise<void> {
  return invoke<void>("open_launcher", { kind, target });
}

// ===== iCloud 同步 =====
export interface SyncStatus {
  enabled: boolean;
  syncDir: string | null;
  machineId: string;
  lastSynced: number | null;
  itemCount: number;
}

export function getSyncStatus(): Promise<SyncStatus> {
  return invoke<SyncStatus>("get_sync_status");
}

export function setSyncDir(newDir: string): Promise<void> {
  return invoke<void>("set_sync_dir", { newDir });
}

export function disableSync(): Promise<void> {
  return invoke<void>("disable_sync");
}

export function triggerSync(): Promise<void> {
  return invoke<void>("trigger_sync");
}
