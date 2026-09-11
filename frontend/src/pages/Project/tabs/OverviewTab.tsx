import { FileText } from 'lucide-react';
import type { Project } from '@/types';

interface OverviewTabProps {
  project: Project;
}

/** 产品基本信息 Tab：左侧字段 + 右侧描述卡 */
export function OverviewTab({ project }: OverviewTabProps) {
  const rows = [
    { label: '产品编码', value: project.code || '-', mono: true },
    { label: '产品负责人', value: project.leader_name || '-' },
    { label: '创建时间', value: project.created_at?.split('T')[0] || '-' },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {/* 左侧字段 */}
      <div className="space-y-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between border-b border-indigo-50 py-2"
          >
            <span className="text-[13px] text-slate-500">{row.label}</span>
            <span className={`text-[13px] text-slate-800 ${row.mono ? 'font-mono' : ''}`}>
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {/* 右侧描述 */}
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
        <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-indigo-700">
          <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
          产品描述
        </div>
        <p className="text-[13px] leading-relaxed text-slate-600">
          {project.description || '暂无描述'}
        </p>
      </div>
    </div>
  );
}
