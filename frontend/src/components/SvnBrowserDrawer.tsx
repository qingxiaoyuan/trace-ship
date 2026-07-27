import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Breadcrumb, Drawer, Empty, Table } from 'antd';
import { File, Folder, RefreshCw } from 'lucide-react';
import dayjs from 'dayjs';
import { packageApi } from '@/api/package';
import type { PackageConfig, SvnEntry } from '@/types';

/** 文件大小格式化（与打包看板 utils.formatSize 保持一致） */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${bytes} B`;
}

interface SvnBrowserDrawerProps {
  open: boolean;
  /** 目标打包配置（需已启用 SVN 推送） */
  config: PackageConfig | null;
  onClose: () => void;
}

/**
 * SVN 制品目录浏览抽屉
 *
 * 从打包配置的 svn_url 根目录开始，实时调用 svn-entries 接口逐层浏览目录内容（只读）。
 */
export function SvnBrowserDrawer({ open, config, onClose }: SvnBrowserDrawerProps) {
  // 当前相对路径段（相对 config.svn_url）
  const [segments, setSegments] = useState<string[]>([]);
  const path = segments.join('/');

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['svn-entries', config?.id, path],
    queryFn: () => packageApi.listSvnEntries(config!.id, path),
    enabled: open && !!config,
  });

  // 目录在前、文件在后，同类按名称排序
  const entries = useMemo(() => {
    const list = data?.entries ?? [];
    return [...list].sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
    );
  }, [data]);

  const handleClose = () => {
    setSegments([]);
    onClose();
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: SvnEntry) => (
        <span className="flex items-center gap-2">
          {record.kind === 'dir' ? (
            <Folder className="h-4 w-4 shrink-0 text-amber-500" strokeWidth={1.5} />
          ) : (
            <File className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.5} />
          )}
          {record.kind === 'dir' ? (
            <button
              type="button"
              className="text-[13px] font-medium text-indigo-600 hover:text-indigo-500"
              onClick={() => setSegments((prev) => [...prev, name])}
            >
              {name}
            </button>
          ) : (
            <span className="text-[13px] text-slate-700">{name}</span>
          )}
        </span>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 100,
      render: (size: number, record: SvnEntry) => (
        <span className="font-mono text-[12px] text-slate-500">
          {record.kind === 'dir' ? '-' : formatSize(size)}
        </span>
      ),
    },
    {
      title: '版本',
      dataIndex: 'revision',
      key: 'revision',
      width: 80,
      render: (revision: string) => (
        <span className="font-mono text-[12px] text-slate-500">{revision ? `r${revision}` : '-'}</span>
      ),
    },
    {
      title: '作者',
      dataIndex: 'author',
      key: 'author',
      width: 110,
      render: (author: string) => <span className="text-[12px] text-slate-500">{author || '-'}</span>,
    },
    {
      title: '提交时间',
      dataIndex: 'date',
      key: 'date',
      width: 150,
      render: (date: string | null | undefined) => (
        <span className="text-[12px] text-slate-500">
          {date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-'}
        </span>
      ),
    },
  ];

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      width={720}
      title={
        <div>
          <div className="text-[15px] font-semibold text-slate-900">SVN 制品浏览</div>
          {config && (
            <div className="mt-0.5 text-[12px] font-normal text-slate-400">
              {config.name} · {data?.base_url || config.svn_url}
            </div>
          )}
        </div>
      }
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <Breadcrumb
          items={[
            {
              title: (
                <button
                  type="button"
                  className="text-[13px] text-indigo-600 hover:text-indigo-500"
                  onClick={() => setSegments([])}
                >
                  根目录
                </button>
              ),
            },
            ...segments.map((seg, idx) => ({
              title:
                idx === segments.length - 1 ? (
                  <span className="text-[13px] text-slate-700">{seg}</span>
                ) : (
                  <button
                    type="button"
                    className="text-[13px] text-indigo-600 hover:text-indigo-500"
                    onClick={() => setSegments(segments.slice(0, idx + 1))}
                  >
                    {seg}
                  </button>
                ),
            })),
          ]}
        />
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} strokeWidth={1.5} />
          刷新
        </button>
      </div>

      {error ? (
        <Alert
          type="error"
          showIcon
          message="SVN 目录加载失败"
          description="请确认 SVN 服务可达且凭证有效，可点击右上角刷新重试。"
        />
      ) : (
        <Table<SvnEntry>
          rowKey="name"
          size="small"
          loading={isLoading}
          dataSource={entries}
          columns={columns}
          pagination={false}
          locale={{ emptyText: <Empty description="目录为空" /> }}
        />
      )}

      <div className="mt-3 text-[12px] text-slate-400">数据来自 SVN 实时查询（只读）</div>
    </Drawer>
  );
}
