import type { Project } from '@/types';

interface OverviewTabProps {
  project: Project;
}

function formatFieldValue(value: unknown): string {
  if (value === undefined || value === null) return '-';
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

export function OverviewTab({ project }: OverviewTabProps) {
  const items = [
    { label: '项目编码', value: formatFieldValue(project.code), mono: true },
    { label: '项目负责人', value: formatFieldValue(project.leader_name) },
    { label: '版本号规则', value: formatFieldValue(project.version_rule) },
    { label: '发布规则', value: formatFieldValue(project.release_rule) },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-5">
      {items.map((item) => (
        <div
          key={item.label}
          className="p-4 rounded-xl bg-slate-50/60 border border-slate-100 hover:border-slate-200 transition-colors"
        >
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {item.label}
          </label>
          <p
            className={`text-sm font-semibold text-slate-900 mt-1.5 ${
              item.mono ? 'font-mono' : ''
            }`}
          >
            {item.value}
          </p>
        </div>
      ))}
      <div className="col-span-2 p-4 rounded-xl bg-slate-50/60 border border-slate-100 hover:border-slate-200 transition-colors">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          描述
        </label>
        <p className="text-sm text-slate-700 mt-1.5 leading-relaxed">{formatFieldValue(project.description)}</p>
      </div>
    </div>
  );
}
