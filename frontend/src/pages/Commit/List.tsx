import { useMemo, useState } from 'react';
import { Table, Button, Space, message } from 'antd';
import { useQuery } from '@tanstack/react-query';
import {
  SyncOutlined,
  EyeOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { reviewStatusOptions } from '@/mock/dashboard';
import { commitApi } from '@/api/commit';
import { formatRelativeTime } from '@/utils/time';
import type { CommitRecord, ReviewStatus } from '@/types';

const reviewStatusMap: Record<ReviewStatus, { status: 'success' | 'warning' | 'danger'; text: string }> = {
  pass: { status: 'success', text: '合规' },
  warning: { status: 'warning', text: '警告' },
  illegal: { status: 'danger', text: '不合规' },
};

const changeTypeStatusMap: Record<string, 'info' | 'warning' | 'neutral'> = {
  'A类': 'info',
  'F类': 'warning',
  '-': 'neutral',
};

const projectOptions = [
  { label: '演示项目', value: '演示项目' },
];

const branchOptions = [
  { label: 'master', value: 'master' },
  { label: 'develop', value: 'develop' },
];

function getMessageSummary(record: CommitRecord): string {
  const lines = record.message.split('\n');
  const firstLine = lines[0];
  const typePrefixMatch = firstLine.match(/^变更类型[：:]\s*([A-Z类-]+)/);
  if (typePrefixMatch) {
    const short = typePrefixMatch[1].replace('类', '');
    const contentLine = lines[1] || '';
    const content = contentLine.replace(/^更新内容[：:]\s*/, '');
    return `[${short}] ${content || firstLine}`;
  }
  if (record.change_type && record.change_type !== '-') {
    const short = record.change_type.replace('类', '');
    return `[${short}] ${firstLine}`;
  }
  return firstLine;
}

export default function CommitList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    project_name: undefined as string | undefined,
    branch: undefined as string | undefined,
    author: '',
    review_status: undefined as string | undefined,
  });
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  const { data, isLoading } = useQuery({
    queryKey: ['commits', filters, pagination.current, pagination.pageSize],
    queryFn: () =>
      commitApi.getCommits({
        page: pagination.current,
        page_size: pagination.pageSize,
        project_name: filters.project_name || undefined,
        branch: filters.branch || undefined,
        author: filters.author || undefined,
        review_status: filters.review_status || undefined,
      }),
  });

  const results = useMemo(() => data?.results || [], [data]);
  const alertTotal = useMemo(() => results.filter((r) => r.review_status === 'illegal').length, [results]);
  const configAlertCount = useMemo(
    () =>
      results.filter(
        (a) =>
          a.review_status === 'illegal' &&
          (a.message.includes('配置') ||
            a.message.toLowerCase().includes('config') ||
            a.message.includes('[System]'))
      ).length,
    [results]
  );

  const columns = [
    {
      title: 'Commit',
      dataIndex: 'commit_hash',
      render: (hash: string) => (
        <span className="font-mono text-xs text-slate-500">{hash.slice(0, 8)}</span>
      ),
    },
    { title: '作者', dataIndex: 'author' },
    {
      title: '时间',
      dataIndex: 'committed_at',
      render: (text: string) => (
        <span className="text-slate-500">{formatRelativeTime(text)}</span>
      ),
    },
    {
      title: '消息摘要',
      dataIndex: 'message',
      ellipsis: true,
      render: (_: string, record: CommitRecord) => (
        <span className="font-medium text-slate-900">{getMessageSummary(record)}</span>
      ),
    },
    {
      title: '变更类型',
      dataIndex: 'change_type',
      render: (type: string) => {
        const status = changeTypeStatusMap[type] || 'neutral';
        return <StatusTag status={status}>{type === '-' ? '-' : type}</StatusTag>;
      },
    },
    {
      title: '合规状态',
      dataIndex: 'review_status',
      render: (status: ReviewStatus) => {
        const item = reviewStatusMap[status];
        return <StatusTag status={item.status}>{item.text}</StatusTag>;
      },
    },
    {
      title: '操作',
      width: 100,
      render: (_: unknown, record: CommitRecord) => (
        <Space size="small">
          <span
            className="inline-flex items-center gap-1 text-sm text-blue-600 cursor-pointer hover:text-blue-700"
            onClick={() => navigate(`/commits/${record.id}`)}
          >
            <EyeOutlined />
            详情
          </span>
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <TsCard title="提交记录" bodyStyle={{ padding: 0 }}>
        <div className="px-5 py-4 bg-[#F7F6F3] border-b border-[#EAEAEA]">
          <SearchFilterBar
            filters={[
              {
                key: 'project_name',
                type: 'select',
                placeholder: '选择项目',
                width: 176,
                options: projectOptions,
              },
              {
                key: 'branch',
                type: 'select',
                placeholder: '选择分支',
                width: 144,
                options: branchOptions,
              },
              { key: 'author', type: 'input', placeholder: '提交人', width: 128 },
              {
                key: 'review_status',
                type: 'select',
                placeholder: '合规状态',
                width: 144,
                options: reviewStatusOptions,
              },
            ]}
            values={filters}
            onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value as string }))}
            onSearch={() => setPagination((prev) => ({ ...prev, current: 1 }))}
            onReset={() => {
              setFilters({ project_name: undefined, branch: undefined, author: '', review_status: undefined });
              setPagination((prev) => ({ ...prev, current: 1 }));
            }}
            extra={
              <Button type="primary" icon={<SyncOutlined />} onClick={() => message.info('同步提交')}>
                同步提交
              </Button>
            }
          />
        </div>

        <div className="p-5">
          <Table
            rowKey="id"
            columns={columns}
            dataSource={results}
            loading={isLoading}
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total: data?.total || 0,
              showSizeChanger: true,
            }}
            onChange={(p) => {
              setPagination({ current: p.current || 1, pageSize: p.pageSize || 10 });
            }}
          />
        </div>
      </TsCard>

      <TsCard bodyStyle={{ padding: 20 }}>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-amber-100 text-amber-600 text-2xl">
            <ExclamationCircleOutlined />
          </div>
          <div className="flex-1">
            <div className="text-base font-semibold text-slate-900">非法提交预警</div>
            <div className="text-sm text-slate-500 mt-0.5">
              发现 {alertTotal} 条不合规提交，其中 {configAlertCount} 条包含配置项改动
            </div>
          </div>
          <Button type="default" onClick={() => navigate('/commits/alerts')}>
            查看预警
          </Button>
        </div>
      </TsCard>
    </div>
  );
}
