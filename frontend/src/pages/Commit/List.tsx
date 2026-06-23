import { useMemo, useState } from 'react';
import { Table, Button, Space, message } from 'antd';
import {
  SyncOutlined,
  RobotOutlined,
  EyeOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import {
  mockCommits,
  mockCommitAlerts,
  reviewStatusOptions,
} from '@/mock/dashboard';
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

const projectOptions = Array.from(
  new Map(
    mockCommits
      .filter((c) => c.project_name)
      .map((c) => [c.project_name, c.project_name] as [string, string])
  ).entries()
).map(([label, value]) => ({ label, value }));

const branchOptions = Array.from(new Set(mockCommits.map((c) => c.branch))).map((b) => ({
  label: b,
  value: b,
}));

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

  const filteredData = useMemo(() => {
    return mockCommits.filter((item) => {
      if (filters.project_name && item.project_name !== filters.project_name) return false;
      if (filters.branch && item.branch !== filters.branch) return false;
      if (filters.author && !item.author.includes(filters.author)) return false;
      if (filters.review_status && item.review_status !== filters.review_status) return false;
      return true;
    });
  }, [filters]);

  const alertTotal = mockCommitAlerts.length;
  const configAlertCount = useMemo(
    () =>
      mockCommitAlerts.filter(
        (a) =>
          a.illegal_reason.includes('配置') ||
          a.message.includes('配置') ||
          a.message.toLowerCase().includes('config') ||
          a.message.includes('[System]')
      ).length,
    []
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
      width: 160,
      render: (_: unknown, record: CommitRecord) => (
        <Space size="small">
          <span
            className="inline-flex items-center gap-1 text-sm text-violet-600 cursor-pointer hover:text-violet-700"
            onClick={() => navigate(`/commits/${record.id}/ai-review`)}
          >
            <RobotOutlined />
            AI 审查
          </span>
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
      <TsCard bodyStyle={{ padding: 20 }}>
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
          onSearch={() => message.info('执行查询')}
          onReset={() =>
            setFilters({ project_name: undefined, branch: undefined, author: '', review_status: undefined })
          }
          extra={
            <Button type="primary" icon={<SyncOutlined />} onClick={() => message.info('同步提交')}>
              同步提交
            </Button>
          }
        />
      </TsCard>

      <TsCard title="提交记录">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filteredData}
          pagination={{ pageSize: 6 }}
        />
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
