import { Row, Col, Progress, Button, Avatar, List, Typography } from 'antd';
import {
  RocketOutlined,
  AuditOutlined,
  BuildOutlined,
  FileSearchOutlined,
  WarningOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { mockDashboardOverview, mockRecentReleases, mockTodoList } from '@/mock/dashboard';
import { tokens } from '@/styles/theme';

const { Text, Title } = Typography;

const kpiCards = [
  {
    title: '近 7 天发布数',
    value: '12',
    extra: <StatusTag status="success">+20% 较上周</StatusTag>,
    icon: <RocketOutlined />,
    iconBg: 'linear-gradient(135deg, #3B82F6, #60A5FA)',
  },
  {
    title: '待审批数',
    value: mockDashboardOverview.pending_audit_count.toString(),
    extra: <Text className="text-slate-400">2 个待审批 · 1 个即将超时</Text>,
    icon: <AuditOutlined />,
    iconBg: 'linear-gradient(135deg, #F59E0B, #FBBF24)',
  },
  {
    title: '构建成功/失败',
    value: '10 / 2',
    extra: <StatusTag status="danger">2 失败 需关注</StatusTag>,
    icon: <BuildOutlined />,
    iconBg: 'linear-gradient(135deg, #EF4444, #F87171)',
  },
  {
    title: 'Commit 合规率',
    value: '92.5%',
    extra: <Progress percent={92.5} size="small" showInfo={false} />,
    icon: <FileSearchOutlined />,
    iconBg: 'linear-gradient(135deg, #6366F1, #818CF8)',
  },
];

const todoList = mockTodoList;

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <Row gutter={[16, 16]}>
        {kpiCards.map((card) => (
          <Col xs={24} sm={12} lg={6} key={card.title}>
            <TsCard bodyStyle={{ padding: 20 }}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <Text className="text-slate-500 text-sm">{card.title}</Text>
                  <Title level={3} className="!m-0 !mt-2 !text-slate-900">{card.value}</Title>
                  <div className="mt-3">{card.extra}</div>
                </div>
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-xl"
                  style={{ background: card.iconBg }}
                >
                  {card.icon}
                </div>
              </div>
            </TsCard>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <TsCard
            title="最近发布"
            extra={
              <div className="flex items-center gap-4">
                <Text className="text-slate-400 text-sm">最近 10 条发布记录</Text>
                <Button type="text">查看全部 <RightOutlined /></Button>
              </div>
            }
          >
            <List
              dataSource={mockRecentReleases}
              renderItem={(item) => (
                <List.Item className="!px-0">
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-4">
                      <Text className="font-medium text-slate-900 w-32">{item.version}</Text>
                      <Text className="text-slate-500 w-32">{item.project_name}</Text>
                      <StatusTag status={item.release_type === 'formal' ? 'primary' : 'warning'}>
                        {item.release_type === 'formal' ? '正式' : '测试'}
                      </StatusTag>
                      <StatusTag status={item.status === 'released' ? 'success' : 'warning'}>
                        {item.status === 'released' ? '已发布' : '构建中'}
                      </StatusTag>
                    </div>
                    <Text className="text-slate-400">{item.created_at?.split('T')[0]}</Text>
                  </div>
                </List.Item>
              )}
            />
          </TsCard>
        </Col>

        <Col xs={24} lg={8} className="space-y-6">
          <TsCard title="我的待办">
            <List
              dataSource={todoList}
              renderItem={(item) => (
                <List.Item className="!px-0">
                  <div className="flex items-center gap-3 w-full bg-slate-50 rounded-xl p-3">
                    <Avatar
                      size="large"
                      style={{ background: tokens.colors.userAvatar }}
                    >
                      {item.applicant.charAt(0)}
                    </Avatar>
                    <div className="flex-1">
                      <Text className="font-medium text-slate-900 block">{item.title}</Text>
                      <Text className="text-xs text-slate-400">{item.applicant} · {item.time}</Text>
                    </div>
                    <Button type="link">去审批</Button>
                  </div>
                </List.Item>
              )}
            />
          </TsCard>

          <TsCard bodyStyle={{ padding: 20 }}>
            <div className="flex items-center gap-4">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-2xl"
                style={{ background: 'linear-gradient(135deg, #F59E0B, #FBBF24)' }}
              >
                <WarningOutlined />
              </div>
              <div className="flex-1">
                <Title level={3} className="!m-0 !text-slate-900">7</Title>
                <Text className="text-slate-500">待处理的不合规 commit</Text>
              </div>
              <Button type="default">查看</Button>
            </div>
          </TsCard>
        </Col>
      </Row>
    </div>
  );
}
