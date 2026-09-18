import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Modal } from 'antd';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, FolderKanban, GitFork, GitPullRequestArrow, Hammer, Rocket, Search } from 'lucide-react';
import type { LucideIcon } from '@/layouts/components/navMenu';
import { useAuthStore } from '@/stores/authStore';
import { searchApi } from '@/api/search';
import type { SearchResultGroups } from '@/api/search';
import { applyRepoDeepLinks, getVisibleEntries, matchEntry } from './registry';
import type { CommandEntry } from './registry';
import { useCommandPaletteStore } from './store';
import { useRecentVisits } from '@/hooks/useRecentVisits';

/** 实体搜索结果分组展示配置（与后端 /api/search/ 的分组字段对齐） */
const ENTITY_GROUPS: { key: keyof SearchResultGroups; label: string; icon: LucideIcon }[] = [
  { key: 'projects', label: '项目/产品', icon: FolderKanban },
  { key: 'repositories', label: '仓库', icon: GitFork },
  { key: 'releases', label: '发布单', icon: Rocket },
  { key: 'workflows', label: '审批单', icon: GitPullRequestArrow },
  { key: 'packages', label: '打包任务', icon: Hammer },
];

/** 面板内统一的列表项结构（静态条目与实体搜索结果共用渲染与键盘导航） */
interface PaletteItem {
  key: string;
  name: string;
  path: string;
  icon: LucideIcon;
  /** 静态条目的路径提示 */
  hint?: string;
  /** 实体结果的副标题 */
  subtitle?: string;
}

interface PaletteSection {
  label: string;
  items: PaletteItem[];
}

const KBD_CLASS =
  'rounded border border-indigo-100 bg-white px-1 py-0.5 text-[10px] font-medium text-slate-400';

function entryToItem(entry: CommandEntry): PaletteItem {
  return {
    key: entry.id,
    name: entry.name,
    path: entry.path,
    icon: entry.icon,
    hint: entry.hint,
  };
}

/**
 * 面板内容（输入框 + 结果列表）。
 * 通过 Modal destroyOnHidden 在每次打开时重新挂载，内部状态天然是全新的一份，
 * 无需在关闭时手动重置。
 */
function PalettePanel() {
  const menus = useAuthStore((state) => state.menus);
  const navigate = useNavigate();
  const recentVisits = useRecentVisits();
  const recentRepo = recentVisits.find((visit) => visit.type === 'repository');

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [entityResults, setEntityResults] = useState<SearchResultGroups | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // 防抖请求序号：只接受最后一次输入的结果，避免慢响应覆盖新结果
  const searchSeqRef = useRef(0);

  // 挂载（即面板打开）后聚焦输入框
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  // 实体搜索：输入防抖 300ms 调聚合接口；后端未上线/异常时静默降级（只展示静态组）
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) return;
    const seq = ++searchSeqRef.current;
    const timer = setTimeout(() => {
      searchApi
        .search(q)
        .then((data) => {
          if (seq === searchSeqRef.current) setEntityResults(data);
        })
        .catch(() => {
          if (seq === searchSeqRef.current) setEntityResults(null);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const sections = useMemo<PaletteSection[]>(() => {
    const q = query.trim();
    const matched = applyRepoDeepLinks(
      getVisibleEntries(menus),
      recentRepo ? String(recentRepo.id) : undefined,
      recentRepo?.title,
    ).filter((entry) => matchEntry(entry, q));
    const result: PaletteSection[] = [];

    const menuItems = matched.filter((entry) => entry.group === 'menu').map(entryToItem);
    if (menuItems.length > 0) result.push({ label: '功能入口', items: menuItems });

    const actionItems = matched.filter((entry) => entry.group === 'action').map(entryToItem);
    if (actionItems.length > 0) result.push({ label: '快捷操作', items: actionItems });

    if (q && entityResults) {
      for (const group of ENTITY_GROUPS) {
        const list = entityResults[group.key];
        if (!list?.length) continue;
        result.push({
          label: group.label,
          items: list.map((item) => ({
            key: `${group.key}-${item.id}`,
            name: item.name,
            path: item.path,
            icon: group.icon,
            subtitle: item.subtitle,
          })),
        });
      }
    }
    return result;
  }, [query, menus, entityResults, recentRepo]);

  // 键盘导航基于扁平化的可见列表；结果数变化时钳制选中下标（派生值，无需额外 state）
  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const safeSelected = Math.min(selected, Math.max(0, flatItems.length - 1));

  // 选中项滚动到可视区域
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [safeSelected]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelected(0);
    // 关键词变化时立即丢弃上一轮实体结果，避免与新静态匹配混在一起
    setEntityResults(null);
  };

  const openItem = (item?: PaletteItem) => {
    if (!item) return;
    useCommandPaletteStore.getState().setOpen(false);
    navigate(item.path);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((value) => Math.min(value + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((value) => Math.max(value - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openItem(flatItems[safeSelected]);
    }
  };

  let cursor = -1;

  return (
    <>
      {/* 输入行 */}
      <div className="flex items-center gap-2.5 border-b border-indigo-50 px-4 py-3">
        <Search className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.5} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索功能、项目、仓库、发布…"
          className="h-7 min-w-0 flex-1 bg-transparent text-[14px] text-slate-800 outline-none placeholder:text-slate-400"
        />
        <kbd className={KBD_CLASS}>esc</kbd>
      </div>

      {/* 结果列表 */}
      <div ref={listRef} className="max-h-[min(380px,50vh)] overflow-y-auto pb-1">
        {flatItems.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-slate-400">
            未找到匹配的功能或结果
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.label}>
              <div className="px-4 pb-1 pt-3 text-[11px] font-medium text-slate-400">
                {section.label}
              </div>
              {section.items.map((item) => {
                cursor += 1;
                const index = cursor;
                const active = index === safeSelected;
                return (
                  <button
                    key={item.key}
                    type="button"
                    data-active={active}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => openItem(item)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${active ? 'bg-indigo-50' : ''}`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${active ? 'bg-white text-indigo-600 shadow-sm' : 'bg-slate-100 text-slate-500'}`}
                    >
                      <item.icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[13px] ${active ? 'font-medium text-indigo-700' : 'text-slate-700'}`}
                      >
                        {item.name}
                      </span>
                      {item.hint || item.subtitle ? (
                        <span className="block truncate text-[11px] text-slate-400">
                          {item.hint || item.subtitle}
                        </span>
                      ) : null}
                    </span>
                    {active ? (
                      <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-indigo-400" strokeWidth={1.5} />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* 底部快捷键提示条 */}
      <div className="flex items-center gap-4 border-t border-indigo-50 px-4 py-2.5 text-[11px] text-slate-400">
        <span className="flex items-center gap-1">
          <kbd className={KBD_CLASS}>↑</kbd>
          <kbd className={KBD_CLASS}>↓</kbd>
          选择
        </span>
        <span className="flex items-center gap-1">
          <kbd className={KBD_CLASS}>↵</kbd>
          打开
        </span>
        <span className="flex items-center gap-1">
          <kbd className={KBD_CLASS}>esc</kbd>
          关闭
        </span>
      </div>
    </>
  );
}

export function CommandPalette() {
  const open = useCommandPaletteStore((state) => state.open);
  const setOpen = useCommandPaletteStore((state) => state.setOpen);

  // 全局快捷键：⌘K / Ctrl+K 唤起或关闭
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useCommandPaletteStore.getState().toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      closable={false}
      title={null}
      width={560}
      styles={{ body: { padding: 0 } }}
      maskClosable
      destroyOnHidden
    >
      <PalettePanel />
    </Modal>
  );
}
