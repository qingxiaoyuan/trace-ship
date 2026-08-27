import { useNavigate } from 'react-router-dom';
import type { PipelineColumn, PipelineRange } from '../types';
import { BuildPipelineCard, EmptyPipelineCard, PipelineCard } from './PipelineCard';

/** 发布流水线面板：按状态分列展示发布卡片，支持时间范围切换；整列与卡片均可点击跳转 */
export function PipelinePanel({
  columns,
  range,
  onRangeChange,
}: {
  columns: PipelineColumn[];
  range: PipelineRange;
  onRangeChange: (range: PipelineRange) => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="tech-card rounded-xl p-5 lg:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight text-slate-900">发布流水线</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">点击任意状态列，查看该状态下的全部发布</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50/40 p-0.5">
          {([
            { key: 'all', label: '全部' },
            { key: 'today', label: '今日' },
            { key: 'week', label: '本周' },
          ] as const).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => onRangeChange(opt.key)}
              className={
                range === opt.key
                  ? 'rounded-md bg-white px-2.5 py-1 text-[12px] font-medium text-indigo-600 shadow-sm'
                  : 'rounded-md px-2.5 py-1 text-[12px] font-medium text-slate-500 transition-colors hover:text-slate-700'
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
        {columns.map((column) => (
          <div
            key={column.key}
            role="button"
            tabIndex={0}
            onClick={() => navigate(column.to)}
            onKeyDown={(e) => {
              // 内部卡片的按键不触发列跳转
              if (e.target !== e.currentTarget) return;
              if (e.key === ' ') e.preventDefault();
              if (e.key === 'Enter' || e.key === ' ') navigate(column.to);
            }}
            className={`cursor-pointer rounded-lg border p-3 transition-shadow hover:shadow-sm ${column.tone}`}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${column.dot}`} />
                <span className="text-[12px] font-medium">{column.label}</span>
              </div>
              <span className="text-[11px] font-medium">{column.count}</span>
            </div>
            <div className="space-y-2">
              {column.releases.map((release) => (
                <PipelineCard
                  key={release.id}
                  release={release}
                  status={column.key}
                  cardBorder={column.cardBorder}
                  onClick={() => navigate(`/releases/${release.id}`)}
                />
              ))}
              {(column.builds || []).map((task) => (
                <BuildPipelineCard
                  key={task.id}
                  task={task}
                  cardBorder={column.cardBorder}
                  onClick={() => navigate(`/packages/${task.id}`)}
                />
              ))}
              {column.releases.length === 0 && (column.builds || []).length === 0 ? (
                <EmptyPipelineCard />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
