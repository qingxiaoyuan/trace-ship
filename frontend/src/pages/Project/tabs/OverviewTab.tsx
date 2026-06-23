import type { Project } from '@/types';

interface OverviewTabProps {
  project: Project;
}

export function OverviewTab({ project }: OverviewTabProps) {
  const items = [
    { label: '项目编码', value: project.code, mono: true },
    { label: '项目负责人', value: project.leader_name },
    { label: '版本号规则', value: project.version_rule || '-' },
    { label: '发布周期', value: project.release_cycle || '-' },
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
        <p className="text-sm text-slate-700 mt-1.5 leading-relaxed">{project.description}</p>
      </div>
    </div>
  );
}
