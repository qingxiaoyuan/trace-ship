import type { TodoFilter, TodoItem } from '../types';

/** 我的待办列表面板，支持按类型过滤 */
export function TodoPanel({
  items,
  filter,
  onFilterChange,
}: {
  items: TodoItem[];
  filter: TodoFilter;
  onFilterChange: (filter: TodoFilter) => void;
}) {
  return (
    <div className="tech-card rounded-xl lg:col-span-2">
      <div className="flex items-center justify-between border-b border-indigo-50 px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">我的待办</h2>
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">
            {items.length}
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50/40 p-0.5">
          {([
            { key: 'all', label: '全部' },
            { key: 'audit', label: '审批' },
            { key: 'build', label: '构建' },
          ] as const).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => onFilterChange(opt.key)}
              className={
                filter === opt.key
                  ? 'rounded-md bg-white px-2.5 py-1 text-[12px] font-medium text-indigo-600 shadow-sm'
                  : 'rounded-md px-2.5 py-1 text-[12px] font-medium text-slate-500 transition-colors hover:text-slate-700'
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="divide-y divide-indigo-50/50">
        {items.length > 0 ? (
          items.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.key} className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-indigo-50/30">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.iconClass}`}>
                  <Icon className="h-4 w-4" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-slate-900">{item.title}</span>
                    <span className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] font-medium text-slate-500">
                      {item.project}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{item.meta}</div>
                </div>
                <div className="shrink-0">{item.actions}</div>
              </div>
            );
          })
        ) : (
          <div className="px-5 py-8 text-center text-[13px] text-slate-400">暂无待办任务</div>
        )}
      </div>
    </div>
  );
}
