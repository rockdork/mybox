import { useMemo, useState } from "react";
import type { InboxItem } from "./types";

/* ------------------------------------------------------------------ */
/*  日历面板 — 工作台右侧：月视图 + 选中日期的任务列表                  */
/*  设计参照截图：Apple 原生风 / 浅深双主题 / token 化                 */
/* ------------------------------------------------------------------ */

const WEEK_DAYS = ["一", "二", "三", "四", "五", "六", "日"];

/** 将时间戳归零到当天 00:00:00 本地时间 */
function toLocalDay(ts: number): Date {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 两个日期是否同一天（本地时区） */
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** 格式化日期标题如「2026-07-08 周三」 */
function formatDateHeader(d: Date): string {
  const w = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd} 周${w}`;
}

type TaskMap = Map<string, { open: number; done: number }>;

function buildTaskMap(tasks: InboxItem[]): TaskMap {
  const m = new Map<string, { open: number; done: number }>();
  for (const t of tasks) {
    if (t.item_type !== "task") continue;
    const key = toLocalDay(t.created_at).toISOString().slice(0, 10);
    const prev = m.get(key) ?? { open: 0, done: 0 };
    if (t.status === "done") prev.done++;
    else prev.open++;
    m.set(key, prev);
  }
  return m;
}

/** 生成月份网格（6 行 x 7 列），周一起始 */
function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  // 周一 = 1, 周日 = 0 → 转换为周一起始的偏移
  let startOffset = first.getDay() - 1;
  if (startOffset < 0) startOffset = 6; // 周日往前推 6 天

  const start = new Date(year, month, 1 - startOffset);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  return days;
}

/* ---- 图标（内联 SVG，与 App.tsx Ico 风格一致）---- */
const ChevronLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={18} height={18}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const ChevronRight = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={18} height={18}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/* ================================================================== */
interface CalendarPanelProps {
  tasks: InboxItem[];
}
export default function CalendarPanel({ tasks }: CalendarPanelProps) {
  const today = useMemo(() => new Date(), []);

  // 当前显示月份（本地时区）
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  // 选中的日期，默认今天
  const [selected, setSelected] = useState<Date>(today);

  const taskMap = useMemo(() => buildTaskMap(tasks), [tasks]);

  // 当月有任务的天数统计
  const activeDaysThisMonth = useMemo(() => {
    let n = 0;
    const prefix = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-`;
    for (const [k] of taskMap) {
      if (k.startsWith(prefix)) n++;
    }
    return n;
  }, [taskMap, viewYear, viewMonth]);

  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  // 选中日期当天的任务
  const dayTasks = useMemo(
    () =>
      tasks.filter(
        (t) => t.item_type === "task" && sameDay(toLocalDay(t.created_at), selected)
      ),
    [tasks, selected]
  );

  const goPrev = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };
  const goNext = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const goToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setSelected(today);
  };

  /* ---- 渲染 ---- */
  return (
    <div className="cal">
      {/* ===== 月导航头部 ===== */}
      <div className="cal-head">
        <button className="cal-nav-btn" onClick={goPrev} title="上个月">
          <ChevronLeft />
        </button>
        <div className="cal-month-info">
          <div className="cal-month-title">
            {viewYear}年{viewMonth + 1}月
          </div>
          {activeDaysThisMonth > 0 && (
            <div className="cal-month-sub">
              {activeDaysThisMonth} 天有任务
            </div>
          )}
        </div>
        <button className="cal-nav-btn" onClick={goNext} title="下个月">
          <ChevronRight />
        </button>
      </div>

      {/* ===== 星期头 ===== */}
      <div className="cal-weekdays">
        {WEEK_DAYS.map((d) => (
          <span key={d} className="cal-wd">
            {d}
          </span>
        ))}
      </div>

      {/* ===== 日期网格 ===== */}
      <div className="cal-grid">
        {grid.map((d, i) => {
          const isCM = d.getMonth() === viewMonth;
          const isTd = sameDay(d, today);
          const isSel = sameDay(d, selected);
          const key = d.toISOString().slice(0, 10);
          const info = taskMap.get(key);

          return (
            <button
              key={i}
              className={`cal-day${!isCM ? " other-month" : ""}${isSel ? " selected" : ""}${isTd ? " today" : ""}`}
              onClick={() => setSelected(d)}
              type="button"
            >
              <span className="cal-num">{d.getDate()}</span>
              {info && (info.open > 0 || info.done > 0) && (
                <div className="cal-dots">
                  {info.open > 0 && <span className="cal-dot dot-open" />}
                  {info.done > 0 && <span className="cal-dot dot-done" />}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ===== 选中日期任务列表 ===== */}
      <div className="cal-tasks-head">
        <span>{formatDateHeader(selected)}</span>
        <span className="cal-task-count">{dayTasks.length}</span>
      </div>

      <div className="cal-tasks-body">
        {dayTasks.length === 0 ? (
          <div className="cal-empty">这一天没有任务</div>
        ) : (
          dayTasks.map((t) => (
            <div key={t.id} className={`cal-task-row status-${t.status}`}>
              {/* 复用 task-row 的视觉结构 */}
              <span className={`cal-check${t.status === "done" ? " checked" : ""}`}>
                {t.status === "done" && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" width={12} height={12}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              <div className="cal-task-main">
                <div className="cal-task-title">{t.title}</div>
                {t.content && <div className="cal-task-sub">{t.content}</div>}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 回到今天按钮（非本月才显示） */}
      {(viewYear !== today.getFullYear() || viewMonth !== today.getMonth()) && (
        <button className="cal-today-btn" onClick={goToday}>
          回到今天
        </button>
      )}
    </div>
  );
}
