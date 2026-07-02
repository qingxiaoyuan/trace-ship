import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Drawer, Table, Tag } from 'antd';
import { DownloadOutlined, FileTextOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import { packageApi } from '@/api/package';
import type { PackageTask, PackageTaskStatus } from '@/types';

const statusColor: Record<PackageTaskStatus, string> = {
  queued: 'default',
  running: 'processing',
  success: 'success',
  failure: 'error',
  canceled: 'warning',
};

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PackageTaskPage() {
  const navigate = useNavigate();
  const { id: routeTaskId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PackageTask | null>(null);
  const [logText, setLogText] = useState('');
  const pageSize = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['package-tasks', page],
    queryFn: () => packageApi.getTasks({ page, page_size: pageSize }),
  });

  const rows = data?.results || [];
  const total = data?.total || 0;

  const artifacts = useMemo(() => selected?.artifact_info || [], [selected]);
  const selectedTaskId = selected?.id;
  const shouldPollDetail = !!selected && ['queued', 'running'].includes(selected.status);

  const loadTaskDetail = async (taskId: string) => {
    const task = await packageApi.getTask(taskId);
    const blob = await packageApi.getTaskLog(taskId);
    setSelected(task);
    setLogText(await blob.text());
    if (!['queued', 'running'].includes(task.status)) {
      queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
    }
  };

  const openLog = async (task: PackageTask) => {
    setSelected(task);
    await loadTaskDetail(task.id);
  };

  useEffect(() => {
    if (!routeTaskId) return;

    let ignore = false;
    const loadRouteTaskDetail = async () => {
      const task = await packageApi.getTask(routeTaskId);
      const blob = await packageApi.getTaskLog(routeTaskId);
      if (ignore) return;
      setSelected(task);
      setLogText(await blob.text());
    };

    loadRouteTaskDetail();
    return () => {
      ignore = true;
    };
  }, [routeTaskId]);

  useEffect(() => {
    if (!selectedTaskId || !shouldPollDetail) return;

    let ignore = false;
    const timer = window.setInterval(async () => {
      try {
        const task = await packageApi.getTask(selectedTaskId);
        const blob = await packageApi.getTaskLog(selectedTaskId);
        if (ignore) return;
        setSelected(task);
        setLogText(await blob.text());
        if (!['queued', 'running'].includes(task.status)) {
          queryClient.invalidateQueries({ queryKey: ['package-tasks'] });
        }
      } catch {
        // 轮询失败时保留当前展示，下一轮继续尝试。
      }
    }, 3000);

    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [queryClient, selectedTaskId, shouldPollDetail]);

  const downloadArtifact = async (task: PackageTask, artifactId: string, name: string) => {
    const blob = await packageApi.downloadArtifact(task.id, artifactId);
    saveBlob(blob, name);
  };

  return (
    <div className="space-y-5 page-fade-in">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">打包任务</h1>
        <p className="mt-1 text-[13px] text-slate-500">查看系统内置打包任务状态、日志和产物</p>
      </div>

      <div className="tech-card rounded-xl p-4">
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={rows}
          pagination={{ current: page, pageSize, total, onChange: setPage }}
          columns={[
            { title: '任务', dataIndex: 'name', render: (v: string) => <span className="font-medium text-slate-900">{v}</span> },
            { title: '项目', dataIndex: 'project_name' },
            { title: '仓库', dataIndex: 'repository_name' },
            { title: '版本', dataIndex: 'version', render: (v: string) => <span className="font-mono text-xs">{v}</span> },
            { title: 'Tag', dataIndex: 'tag_name', render: (v: string) => <span className="font-mono text-xs">{v}</span> },
            { title: '模式', dataIndex: 'mode_display' },
            {
              title: '状态',
              dataIndex: 'status',
              render: (status: PackageTaskStatus, record) => <Tag color={statusColor[status]}>{record.status_display || status}</Tag>,
            },
            { title: '产物', render: (_, record) => `${record.artifact_info?.length || 0} 个` },
            { title: '创建时间', dataIndex: 'created_at', render: (v: string) => dayjs(v).format('MM-DD HH:mm') },
            {
              title: '操作',
              render: (_, record) => (
                <Button type="text" icon={<FileTextOutlined />} onClick={() => openLog(record)}>
                  日志
                </Button>
              ),
            },
          ]}
        />
      </div>

      <Drawer
        width={720}
        title={selected ? `${selected.name} · 日志` : '任务日志'}
        open={!!selected}
        onClose={() => {
          setSelected(null);
          setLogText('');
          if (routeTaskId) navigate('/packages');
        }}
      >
        <div className="mb-4">
          <div className="mb-2 text-[13px] font-medium text-slate-700">产物</div>
          {artifacts.length ? (
            <div className="space-y-2">
              {artifacts.map((artifact) => (
                <div key={artifact.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                  <div>
                    <div className="font-mono text-[12px] text-slate-800">{artifact.path}</div>
                    <div className="text-[11px] text-slate-400">{Math.ceil(artifact.size / 1024)} KB</div>
                  </div>
                  {selected ? (
                    <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadArtifact(selected, artifact.id, artifact.name)}>
                      下载
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[13px] text-slate-400">暂无产物</div>
          )}
        </div>
        <pre className="min-h-[360px] overflow-auto rounded-lg bg-slate-950 p-4 text-[12px] leading-6 text-slate-100">
          {logText || '暂无日志'}
        </pre>
      </Drawer>
    </div>
  );
}
