import { useMemo, useState } from 'react';
import { Calendar, History, Sparkles } from 'lucide-react';
import { changelogEntries, categoryMeta, type ChangelogCategory } from './changelog';

type Filter = 'all' | ChangelogCategory;

const filterTabs: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'feature', label: '新功能' },
  { key: 'improvement', label: '优化改进' },
  { key: 'fix', label: '问题修复' },
];

/** 系统更新日志：记录每次版本改动的功能、优化与修复 */
export default function Changelog() {
  const [filter, setFilter] = useState<Filter>('all');

  const totalCount = useMemo(
    () => changelogEntries.reduce((sum, e) => sum + e.items.length, 0),
    [],
  );

  const filteredEntries = useMemo(
    () =>
      changelogEntries
        .map((entry) => ({
          ...entry,
          items: filter === 'all' ? entry.items : entry.items.filter((i) => i.category === filter),
        }))
        .filter((entry) => entry.items.length > 0),
    [filter],
  );

  return (
    <div className="space-y-5 page-fade-in">
      {/* 页头 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">更新日志</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            记录系统每次改动的更新功能、优化改进与修复的问题
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50/50 px-2.5 py-1 text-[12px] font-medium text-indigo-600">
            <History className="h-3.5 w-3.5" strokeWidth={1.5} />
            {changelogEntries.length} 个版本
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-500">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
            {totalCount} 条记录
          </span>
        </div>
      </div>

      {/* 分类筛选 */}
      <div className="flex items-center gap-1.5">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
              filter === tab.key
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'border border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 时间线 */}
      <div className="relative space-y-5 before:absolute before:bottom-4 before:left-[7px] before:top-2 before:w-px before:bg-indigo-100">
        {filteredEntries.map((entry) => (
          <div key={entry.version} className="relative pl-8">
            {/* 时间线节点 */}
            <span className="absolute left-0 top-6 flex h-4 w-4 items-center justify-center rounded-full border-2 border-indigo-200 bg-white">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            </span>

            <div className="tech-card rounded-xl p-5">
              {/* 版本头 */}
              <div className="flex flex-wrap items-center gap-2.5 border-b border-indigo-50 pb-3">
                <span className="font-mono text-[15px] font-semibold tracking-tight text-slate-900">
                  {entry.version}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500">
                  <Calendar className="h-3 w-3" strokeWidth={1.5} />
                  {entry.date}
                </span>
                {entry.summary && (
                  <span className="text-[12px] text-slate-400">{entry.summary}</span>
                )}
              </div>

              {/* 变更条目 */}
              <ul className="mt-3 space-y-2">
                {entry.items.map((item, idx) => {
                  const meta = categoryMeta[item.category];
                  return (
                    <li key={idx} className="flex items-start gap-2.5">
                      <span
                        className={`mt-0.5 inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${meta.badge}`}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[13px] leading-relaxed text-slate-700">{item.text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ))}

        {filteredEntries.length === 0 && (
          <div className="py-12 text-center text-[13px] text-slate-400">该分类下暂无更新记录</div>
        )}
      </div>
    </div>
  );
}
