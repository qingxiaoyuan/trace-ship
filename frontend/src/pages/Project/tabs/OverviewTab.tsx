import { FileText } from 'lucide-react';
import type { Project } from '@/types';

interface OverviewTabProps {
  project: Project;
}

/** 读取版本规则格式串 */
function versionRuleFormat(rule: unknown): string {
  if (rule && typeof rule === 'object') {
    const fmt = (rule as Record<string, unknown>).format;
    if (typeof fmt === 'string') return fmt;
  }
  return '-';
}

/** 读取测试版前缀 */
function testPrefix(rule: unknown): string {
  if (rule && typeof rule === 'object') {
    const r = rule as Record<string, unknown>;
    const prefixes = r.tag_prefixes as Record<string, string> | undefined;
    if (prefixes?.beta) return prefixes.beta;
    if (typeof r.test_prefix === 'string') return r.test_prefix;
  }
  return '-';
}

/** 项目基本信息 Tab：左侧字段 + 右侧描述卡 */
export function OverviewTab({ project }: OverviewTabProps) {
  const rows = [
    { label: '项目编码', value: project.code || '-', mono: true },
    { label: '版本规则', value: versionRuleFormat(project.version_rule) },
    { label: '发布类型', value: '正式 / RC / Beta' },
    { label: '测试版前缀', value: testPrefix(project.release_rule), mono: true },
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

      {/* 右侧描述 + 版本规则示例 */}
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
        <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-indigo-700">
          <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
          项目描述
        </div>
        <p className="text-[13px] leading-relaxed text-slate-600">
          {project.description || '暂无描述'}
        </p>
        <div className="mt-4 border-t border-indigo-100 pt-3">
          <div className="mb-2 text-[11px] font-medium text-indigo-700">版本规则示例</div>
          <div className="rounded border border-indigo-100 bg-white p-2.5 font-mono text-[11px] text-slate-600">
            {JSON.stringify(project.version_rule || {})}
          </div>
        </div>
      </div>
    </div>
  );
}
