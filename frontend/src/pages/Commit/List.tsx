import { useState } from 'react';
import { Table, Button, Space, Tag, message, Drawer } from 'antd';
import {
  SyncOutlined,
  RobotOutlined,
  EyeOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { mockCommits, reviewStatusOptions } from '@/mock/dashboard';
import type { CommitRecord } from '@/types';

const changeTypeMap: Record<string, string> = {
  'A类': 'blue',
  'F类': 'orange',
  '-': 'default',
};

export default function CommitList() {
  const [filters, setFilters] = useState({ project_id: undefined, branch: undefined, author: '', review_status: undefined });
  const [data] = useState<CommitRecord[]>(mockCommits);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<CommitRecord | null>(null);

  const handleAiReview = (commit: CommitRecord) => {
    setSelectedCommit(commit);
    setDrawerOpen(true);
  };

  const columns = [
    {
      title: 'Commit',
      dataIndex: 'commit_hash',
      render: (hash: string) => (
        <span className="font-mono text-xs text-slate-500">{hash.slice(0, 12)}</span>
      ),
    },
    { title: '作者', dataIndex: 'author' },
    {
      title: '提交时间',
      dataIndex: 'committed_at',
      render: (text: string) => text?.replace('T', ' ').slice(0, 16),
    },
    { title: '分支', dataIndex: 'branch' },
    {
      title: '消息摘要',
      dataIndex: 'message',
      ellipsis: true,
      render: (text: string) => text?.split('\n')[0],
    },
    {
      title: '变更类型',
      dataIndex: 'change_type',
      render: (type: string) => <Tag color={changeTypeMap[type] || 'default'}>{type}</Tag>,
    },
    {
      title: '合规状态',
      dataIndex: 'review_status',
      render: (status: string) => {
        const map: Record<string, { status: any; text: string }> = {
          pass: { status: 'success', text: '合规' },
          warning: { status: 'warning', text: '警告' },
          illegal: { status: 'danger', text: '不合规' },
        };
        const item = map[status];
        return <StatusTag status={item.status}>{item.text}</StatusTag>;
      },
    },
    {
      title: '操作',
      width: 180,
      render: (_: unknown, record: CommitRecord) => (
        <Space size="small">
          <Button type="text" icon={<RobotOutlined />} onClick={() => handleAiReview(record)}>AI 审查</Button>
          <Button type="text" icon={<EyeOutlined />}>详情</Button>
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
              key: 'project_id',
              type: 'select',
              placeholder: '选择项目',
              width: 176,
              options: [{ label: '核心交易平台', value: '1' }],
            },
            {
              key: 'branch',
              type: 'select',
              placeholder: '选择分支',
              width: 144,
              options: [{ label: 'develop', value: 'develop' }, { label: 'main', value: 'main' }],
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
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onSearch={() => message.info('执行查询')}
          onReset={() => setFilters({ project_id: undefined, branch: undefined, author: '', review_status: undefined })}
          extra={
            <Button type="primary" icon={<SyncOutlined />}>同步提交</Button>
          }
        />
      </TsCard>

      <TsCard title="提交记录">
        <Table rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 10 }} />
      </TsCard>

      <TsCard bodyStyle={{ padding: 20 }}>
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-2xl"
            style={{ background: 'linear-gradient(135deg, #F59E0B, #FBBF24)' }}
          >
            <ExclamationCircleOutlined />
          </div>
          <div className="flex-1">
            <div className="text-2xl font-bold text-slate-900">7</div>
            <div className="text-slate-500">待处理的不合规 commit</div>
          </div>
          <Button type="default">查看预警</Button>
        </div>
      </TsCard>

      <Drawer
        title="AI 审查建议"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={480}
      >
        {selectedCommit && (
          <div className="space-y-4">
            <div className="bg-purple-50 rounded-xl p-4">
              <div className="flex items-center gap-2 text-purple-700 font-semibold mb-2">
                <RobotOutlined /> AI 审查结论
              </div>
              <div className="text-slate-600">
                {selectedCommit.review_status === 'pass'
                  ? '该提交符合规范要求。'
                  : selectedCommit.review_status === 'warning'
                  ? '配置项改动格式不标准，建议统一为 [System] 段落格式。'
                  : '缺少变更类型标记，请补充变更类型后再提交。'}
              </div>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="font-semibold text-slate-900 mb-2">原始 Commit Message</div>
              <pre className="font-mono text-sm text-slate-600 whitespace-pre-wrap">{selectedCommit.message}</pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
