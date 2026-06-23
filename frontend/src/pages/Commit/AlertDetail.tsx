import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Space, Table, Typography, message, Empty } from 'antd';
import {
  ArrowLeftOutlined,
  RobotOutlined,
  BellOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { mockCommitAlerts } from '@/mock/dashboard';
import { formatRelativeTime } from '@/utils/time';
import type { AlertStatus, CommitAlertRecord } from '@/types';

const { Title, Text } = Typography;

const alertStatusMap: Record<AlertStatus, { status: 'warning' | 'success' | 'neutral'; text: string }> = {
  pending: { status: 'warning', text: '待处理' },
  resolved: { status: 'success', text: '已整改' },
  ignored: { status: 'neutral', text: '已忽略' },
};

const summaryConfig: Record<AlertStatus, { label: string; icon: React.ReactNode; color: string; gradient: string }> = {
  pending: {
    label: '待处理',
    icon: <ExclamationCircleOutlined />,
    color: 'amber',
    gradient: 'bg-linear-to-r from-amber-50/50 to-white',
  },
  resolved: {
    label: '已整改',
    icon: <CheckCircleOutlined />,
    color: 'emerald',
    gradient: 'bg-linear-to-r from-emerald-50/50 to-white',
  },
  ignored: {
    label: '已忽略',
    icon: <CloseCircleOutlined />,
    color: 'slate',
    gradient: 'bg-linear-to-r from-slate-50/50 to-white',
  },
};

const borderColorMap: Record<AlertStatus, string> = {
  pending: 'border-l-amber-400',
  resolved: 'border-l-emerald-400',
  ignored: 'border-l-slate-300',
};

const iconColorMap: Record<AlertStatus, string> = {
  pending: 'text-amber-600 bg-amber-100',
  resolved: 'text-emerald-600 bg-emerald-100',
  ignored: 'text-slate-500 bg-slate-100',
};

function SummaryCard({ status, value }: { status: AlertStatus; value: number }) {
  const config = summaryConfig[status];
  return (
    <TsCard
      className={`border-l-4 ${borderColorMap[status]} ${config.gradient}`}
      bodyStyle={{ padding: 20 }}
    >
      <div className="flex items-center gap-4">
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl ${iconColorMap[status]}`}
        >
          {config.icon}
        </div>
        <div>
          <div className="text-sm text-slate-500">{config.label}</div>
          <div className="text-2xl font-bold text-slate-900">{value}</div>
        </div>
      </div>
    </TsCard>
  );
}

export default function CommitAlertDetail() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<CommitAlertRecord[]>(mockCommitAlerts);

  const counts = useMemo(() => {
    return {
      pending: alerts.filter((a) => a.alert_status === 'pending').length,
      resolved: alerts.filter((a) => a.alert_status === 'resolved').length,
      ignored: alerts.filter((a) => a.alert_status === 'ignored').length,
    };
  }, [alerts]);

  const handleStatusChange = (id: string, status: AlertStatus) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, alert_status: status } : a))
    );
    message.success(`已标记为${alertStatusMap[status].text}`);
  };

  const columns = [
    {
      title: '项目',
      dataIndex: 'project_name',
      render: (text?: string) => <span className="text-sm text-slate-900">{text || '-'}</span>,
    },
    {
      title: 'Commit',
      dataIndex: 'commit_hash',
      render: (hash: string) => (
        <span className="font-mono text-xs text-slate-500">{hash.slice(0, 8)}</span>
      ),
    },
    {
      title: '不合规原因',
      dataIndex: 'illegal_reason',
      render: (text: string) => <span className="text-sm text-slate-700">{text}</span>,
    },
    { title: '提交人', dataIndex: 'author' },
    {
      title: '提交时间',
      dataIndex: 'committed_at',
      render: (text: string) => formatRelativeTime(text),
    },
    {
      title: '处理状态',
      dataIndex: 'alert_status',
      render: (status: AlertStatus) => {
        const item = alertStatusMap[status];
        return <StatusTag status={item.status}>{item.text}</StatusTag>;
      },
    },
    {
      title: '操作',
      width: 220,
      render: (_: unknown, record: CommitAlertRecord) => {
        if (record.alert_status === 'pending') {
          return (
            <Space size="small">
              <span
                className="inline-flex items-center gap-1 text-sm text-violet-600 cursor-pointer hover:text-violet-700"
                onClick={() => navigate(`/commits/${record.id}/ai-review`)}
              >
                <RobotOutlined />
                AI 审查
              </span>
              <span
                className="inline-flex items-center gap-1 text-sm text-emerald-600 cursor-pointer hover:text-emerald-700"
                onClick={() => handleStatusChange(record.id, 'resolved')}
              >
                <CheckCircleOutlined />
                已整改
              </span>
              <span
                className="inline-flex items-center gap-1 text-sm text-slate-500 cursor-pointer hover:text-slate-700"
                onClick={() => handleStatusChange(record.id, 'ignored')}
              >
                忽略
              </span>
            </Space>
          );
        }
        return (
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
              onClick={() => message.success('已发送提醒')}
            >
              <BellOutlined />
              发送提醒
            </span>
          </Space>
        );
      },
    },
  ];

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Empty description="暂无不合规提交" />
        <Button type="primary" className="mt-4" onClick={() => navigate('/commits')}>
          返回列表
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TsCard bodyStyle={{ padding: 20 }}>
        <div className="flex items-center justify-between">
          <div>
            <Title level={5} className="m-0! text-slate-900!">非法提交预警详情</Title>
            <Text className="text-sm text-slate-500">集中查看、处理与导出所有不合规提交</Text>
          </div>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/commits')}>
            返回列表
          </Button>
        </div>
      </TsCard>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard status="pending" value={counts.pending} />
        <SummaryCard status="resolved" value={counts.resolved} />
        <SummaryCard status="ignored" value={counts.ignored} />
      </div>

      <TsCard
        title="不合规提交列表"
        extra={
          <Space size="small">
            <Button size="small" onClick={() => message.info('导出 Excel')}>
              导出 Excel
            </Button>
            <Button size="small" onClick={() => message.info('导出 PDF')}>
              导出 PDF
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={alerts}
          pagination={{ pageSize: 10 }}
        />
      </TsCard>
    </div>
  );
}
