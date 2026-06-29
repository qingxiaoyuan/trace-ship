import { useMemo } from 'react';
import {
  Table,
  Checkbox,
  Tag,
  Row,
  Col,
  Space,
  Typography,
  Tooltip,
  Button,
  List,
} from 'antd';
import { EyeOutlined, MergeCellsOutlined, DeleteOutlined } from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import type { CommitRecord } from '@/types';
import { blueColors } from '../constants';
import type { Step2DiffProps } from '../types';

const { Text } = Typography;

/** 步骤 2：提取并编辑 commit 差异 */
export function Step2Diff({
  commits,
  commitsLoading,
  selectedCommits,
  toggleCommit,
  toggleAll,
}: Step2DiffProps) {
  const allSelected = selectedCommits.length === commits.length && commits.length > 0;
  const indeterminate = selectedCommits.length > 0 && selectedCommits.length < commits.length;

  const stats = useMemo(() => {
    const aCount = commits.filter((c) => c.change_type === 'A类').length;
    const fCount = commits.filter((c) => c.change_type === 'F类').length;
    const configCount = commits.filter(
      (c) => c.message.includes('[System]') || c.message.includes('config')
    ).length;
    const illegalCount = commits.filter((c) => c.review_status === 'illegal').length;
    return [
      { label: '总 commit 数', value: commits.length, accent: blueColors.paleBlue },
      { label: 'A 类更新', value: aCount, accent: blueColors.paleGreen },
      { label: 'F 类更新', value: fCount, accent: blueColors.paleYellow },
      { label: '配置项改动', value: configCount, accent: blueColors.paleBlue },
      { label: '不合规提交', value: illegalCount, accent: blueColors.paleRed },
    ];
  }, [commits]);

  const columns = [
    {
      title: (
        <Checkbox
          checked={allSelected}
          indeterminate={indeterminate}
          onChange={toggleAll}
        />
      ),
      width: 56,
      render: (_: unknown, record: CommitRecord) => (
        <Checkbox
          checked={selectedCommits.includes(record.id)}
          onChange={() => toggleCommit(record.id)}
        />
      ),
    },
    {
      title: 'Commit',
      dataIndex: 'commit_hash',
      width: 120,
      render: (hash: string) => (
        <Text
          style={{
            fontFamily: '"SF Mono", "JetBrains Mono", monospace',
            fontSize: 12,
            color: blueColors.charcoal,
          }}
        >
          {hash.slice(0, 12)}
        </Text>
      ),
    },
    { title: '作者', dataIndex: 'author', width: 90 },
    {
      title: '消息摘要',
      dataIndex: 'message',
      ellipsis: true,
      render: (text: string) => text?.split('\n')[0],
    },
    {
      title: '变更类型',
      dataIndex: 'change_type',
      width: 100,
      render: (type: string) => {
        if (type === 'A类') {
          return <Tag style={{ background: blueColors.paleBlue.bg, color: blueColors.paleBlue.text, border: 'none', borderRadius: 9999, fontWeight: 600 }}>A类</Tag>;
        }
        if (type === 'F类') {
          return <Tag style={{ background: blueColors.paleYellow.bg, color: blueColors.paleYellow.text, border: 'none', borderRadius: 9999, fontWeight: 600 }}>F类</Tag>;
        }
        return <Tag style={{ background: blueColors.bone, color: blueColors.muted, border: 'none', borderRadius: 9999 }}>-</Tag>;
      },
    },
    {
      title: '合规状态',
      dataIndex: 'review_status',
      width: 100,
      render: (status: string) => (
        <StatusTag status={status === 'pass' ? 'success' : status === 'warning' ? 'warning' : 'danger'}>
          {status === 'pass' ? '合规' : status === 'warning' ? '警告' : '不合规'}
        </StatusTag>
      ),
    },
    {
      title: '操作',
      width: 70,
      render: () => (
        <Space size="small">
          <Tooltip title="详情">
            <Button type="text" size="small" icon={<EyeOutlined />} style={{ color: blueColors.muted }} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <Row gutter={[24, 24]}>
      <Col xs={24} lg={16}>
        <TsCard
          title={
            <div className="flex items-center justify-between">
              <span style={{ fontWeight: 600, fontSize: 16, color: blueColors.charcoal }}>
                步骤 2：提取并编辑 commit 差异
              </span>
              <Text type="secondary" style={{ fontSize: 13, color: blueColors.muted }}>
                已选 {selectedCommits.length} / {commits.length} 条
              </Text>
            </div>
          }
          extra={
            <Space>
              <Button icon={<MergeCellsOutlined />} disabled={selectedCommits.length === 0} style={{ borderRadius: 6, borderColor: blueColors.border }}>
                合并选中
              </Button>
              <Button icon={<DeleteOutlined />} disabled={selectedCommits.length === 0} style={{ borderRadius: 6, borderColor: blueColors.border }}>
                排除选中
              </Button>
            </Space>
          }
          style={{ borderColor: blueColors.border, borderRadius: 12 }}
        >
          <Table
            rowKey="id"
            columns={columns}
            dataSource={commits}
            loading={commitsLoading}
            pagination={false}
            size="middle"
            style={{ borderRadius: 8, overflow: 'hidden' }}
          />
        </TsCard>
      </Col>
      <Col xs={24} lg={8} className="space-y-5">
        <TsCard
          title={<span style={{ fontWeight: 600, fontSize: 15, color: blueColors.charcoal }}>差异统计</span>}
          style={{ borderColor: blueColors.border, borderRadius: 12 }}
        >
          <List
            dataSource={stats}
            renderItem={(item, index) => (
              <List.Item
                className="px-0! flex justify-between items-center"
                style={{
                  borderBottom: index < stats.length - 1 ? `1px solid ${blueColors.border}` : 'none',
                  padding: '12px 0',
                }}
              >
                <span style={{ color: blueColors.muted, fontSize: 14 }}>{item.label}</span>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 16,
                    color: item.accent.text,
                    background: item.accent.bg,
                    padding: '4px 12px',
                    borderRadius: 9999,
                    minWidth: 36,
                    textAlign: 'center',
                  }}
                >
                  {item.value}
                </span>
              </List.Item>
            )}
          />
        </TsCard>
      </Col>
    </Row>
  );
}
