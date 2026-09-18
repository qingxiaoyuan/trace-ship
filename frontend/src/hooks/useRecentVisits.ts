import { useSyncExternalStore } from 'react';

/** 最近访问条目：项目 / 仓库 / 发布 / 审批详情 */
export interface RecentVisit {
  type: 'project' | 'repository' | 'release' | 'workflow';
  id: number | string;
  title: string;
  subtitle?: string;
  path: string;
  visitedAt: number;
}

const STORAGE_KEY = 'trace-ship.recent-visits';
const MAX_ITEMS = 10;
/** 同页（同标签页）记录后通知订阅者刷新；跨标签页走原生 storage 事件 */
const CHANGE_EVENT = 'trace-ship:recent-visits-changed';

const VALID_TYPES: ReadonlySet<string> = new Set(['project', 'repository', 'release', 'workflow']);

const EMPTY_VISITS: RecentVisit[] = [];

// 缓存解析结果，保证 getSnapshot 返回稳定引用（useSyncExternalStore 要求）
let cachedRaw: string | null = null;
let cachedVisits: RecentVisit[] = EMPTY_VISITS;

/** 解析 localStorage 原始串，过滤脏数据并按访问时间倒序 */
export function parseVisits(raw: string | null): RecentVisit[] {
  if (!raw) return EMPTY_VISITS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_VISITS;
    const visits = parsed.filter(
      (item): item is RecentVisit =>
        !!item &&
        typeof item === 'object' &&
        VALID_TYPES.has((item as RecentVisit).type) &&
        (typeof (item as RecentVisit).id === 'number' || typeof (item as RecentVisit).id === 'string') &&
        typeof (item as RecentVisit).title === 'string' &&
        typeof (item as RecentVisit).path === 'string' &&
        typeof (item as RecentVisit).visitedAt === 'number',
    );
    return visits.length > 0 ? visits.sort((a, b) => b.visitedAt - a.visitedAt) : EMPTY_VISITS;
  } catch {
    return EMPTY_VISITS;
  }
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * 记录一次详情页访问：按 type+id 去重，最新在前，上限 10 条。
 * localStorage 不可用（隐私模式等）时静默忽略。
 */
export function recordVisit(entry: Omit<RecentVisit, 'visitedAt'>): void {
  try {
    const visits = parseVisits(readRaw()).filter(
      (item) => !(item.type === entry.type && String(item.id) === String(entry.id)),
    );
    visits.unshift({ ...entry, visitedAt: Date.now() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visits.slice(0, MAX_ITEMS)));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // 存储写入失败不影响页面正常浏览
  }
}

function getSnapshot(): RecentVisit[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedVisits = parseVisits(raw);
  }
  return cachedVisits;
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

/** 订阅最近访问列表（最新在前，最多 10 条） */
export function useRecentVisits(): RecentVisit[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_VISITS);
}
