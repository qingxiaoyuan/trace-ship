import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { ArchiveRestore, Save } from 'lucide-react';
import { systemApi } from '@/api/system';

/** 打包产物保留天数配置键（后端 apps/package/services/cleanup.py 消费） */
const RETENTION_KEY = 'package_artifact_retention_days';
const RETENTION_DESCRIPTION = '打包产物保留天数（每天 8:00 清理超期产物，默认 30 天）';
const DEFAULT_RETENTION_DAYS = '30';

/** 系统配置页面的打包清理卡片：维护产物保留天数 */
export function PackageCleanupCard() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  // 用户编辑覆盖层：未编辑时直接取服务端值
  const [edited, setEdited] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['system-configs', 'package-cleanup'],
    queryFn: () => systemApi.getConfigs({ keyword: RETENTION_KEY, page_size: 10 }),
  });

  const existing = (data?.results || []).find((c) => c.key === RETENTION_KEY);
  // 未配置时展示默认值（后端同样回退 30 天）
  const form = edited ?? existing?.value ?? DEFAULT_RETENTION_DAYS;

  const saveMutation = useMutation({
    mutationFn: async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        // 留空表示删除该键，回退默认 30 天
        if (existing) await systemApi.deleteConfig(RETENTION_KEY);
        return;
      }
      if (existing) {
        await systemApi.patchConfig(RETENTION_KEY, { value: trimmed });
      } else {
        await systemApi.createConfig({
          key: RETENTION_KEY,
          value: trimmed,
          description: RETENTION_DESCRIPTION,
          is_public: false,
        });
      }
    },
    onSuccess: () => {
      message.success('打包清理配置已保存');
      setEdited(null);
      queryClient.invalidateQueries({ queryKey: ['system-configs'] });
    },
  });

  const days = Number(form);
  const invalid = form.trim() !== '' && (!Number.isInteger(days) || days <= 0);

  return (
    <div className="tech-card rounded-xl px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-emerald">
            <ArchiveRestore className="h-3.5 w-3.5" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-slate-900">打包工作区清理</div>
            <div className="text-[11px] text-slate-400">
              任务结束自动删除源码；每天 8:00 清理超期产物（构建日志保留）；每天 0:00 清理远程节点残留目录
            </div>
          </div>
        </div>
        <button
          type="button"
          disabled={saveMutation.isPending || invalid}
          onClick={() => saveMutation.mutate(form)}
          className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
        >
          <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
          保存
        </button>
      </div>

      <div className="mt-4 max-w-xs">
        <label className="mb-1 block text-[12px] font-medium text-slate-600">产物保留天数</label>
        <input
          type="number"
          min={1}
          value={form}
          onChange={(e) => setEdited(e.target.value)}
          disabled={isLoading}
          placeholder={DEFAULT_RETENTION_DAYS}
          className="input-field w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-700 placeholder-slate-400 outline-none disabled:bg-slate-50"
        />
        <div className={`mt-1 text-[11px] ${invalid ? 'text-rose-500' : 'text-slate-400'}`}>
          {invalid ? '请输入大于 0 的整数' : '超过该天数的打包产物将被删除，留空保存则恢复默认 30 天'}
        </div>
      </div>
    </div>
  );
}
