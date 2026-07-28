import { Button, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { PackageCheck, PackageX, Loader, Clock } from 'lucide-react';
import dayjs from 'dayjs';
import type { PackageTaskStatus, Release } from '@/types';

const statusMap: Record<PackageTaskStatus, { text: string; cls: string; icon: typeof Clock }> = {
  queued: { text: '排队中', cls: 'text-slate-500', icon: Clock },
  running: { text: '打包中', cls: 'text-cyan-600', icon: Loader },
  success: { text: '成功', cls: 'text-emerald-600', icon: PackageCheck },
  failure: { text: '失败', cls: 'text-rose-600', icon: PackageX },
  canceled: { text: '已取消', cls: 'text-amber-600', icon: PackageX },
};

export function ReleasePackages({ release }: { release: Release }) {
  const navigate = useNavigate();
  const tasks = release.package_tasks || [];

  if (!tasks.length) {
    return <div className="py-8 text-center text-[13px] text-slate-400">该发布暂无打包任务</div>;
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => {
        const info = statusMap[task.status];
        const Icon = info.icon;
        return (
          <div key={task.id} className="rounded-lg border border-indigo-50 bg-white px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${info.cls}`} strokeWidth={1.5} />
                  <span className="font-medium text-slate-900">{task.name}</span>
                  <Tag>{task.config_name || '打包'}</Tag>
                  <Tag color={task.build_type === 'web' ? 'blue' : 'purple'}>{task.build_type === 'web' ? 'Web' : 'Qt'}</Tag>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[12px] text-slate-500">
                  <span>{task.status_display || info.text}</span>
                  <span>产物 {task.artifact_count} 个</span>
                  <span>{task.created_at ? dayjs(task.created_at).format('YYYY-MM-DD HH:mm') : '-'}</span>
                </div>
              </div>
              <Button size="small" onClick={() => navigate('/packages')}>
                查看任务
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
