import { useNavigate } from 'react-router-dom';
import { Row, Col, Progress, Button, Avatar, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import {
  RocketOutlined,
  AuditOutlined,
  BuildOutlined,
  FileSearchOutlined,
  WarningOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { TsList } from '@/components/TsList';
import { StatusTag } from '@/components/StatusTag';
import { releaseApi, commitApi, jenkinsApi } from '@/api/dashboard';
import { tokens } from '@/styles/theme';

const { Text, Title } = Typography;

export default function Dashboard() {
  const navigate = useNavigate();

  const { data: releaseData } = useQuery({
    queryKey: ['dashboard-releases'],
    queryFn: () => releaseApi.getReleases({ page_size: 10 }),
  });

  const { data: commitData } = useQuery({
    queryKey: ['dashboard-commits'],
    queryFn: () => commitApi.getCommits({ page_size: 1000 }),
  });

  const { data: buildData } = useQuery({
    queryKey: ['dashboard-builds'],
    queryFn: () => jenkinsApi.getBuilds({ page_size: 1000 }),
  });

  const releases = releaseData?.results || [];
  const commits = commitData?.results || [];
  const builds = buildData?.results || [];

  const recentReleases = releases.slice(0, 10);
  const pendingAuditCount = releases.filter((r) => r.status === 'pending' || r.status === 'auditing').length;
  const successBuilds = builds.filter((b) => b.status === 'success').length;
  const failedBuilds = builds.filter((b) => b.status === 'failure').length;
  const illegalCommits = commits.filter((c) => c.review_status === 'illegal').length;
  const passCommits = commits.filter((c) => c.review_status === 'pass').length;
  const complianceRate = commits.length ? Math.round((passCommits / commits.length) * 1000) / 10 : 100;

  const kpiCards = [
    {
      title: '近 7 天发布数',
      value: String(releases.length),
      extra: <StatusTag status="success">+20% 较上周</StatusTag>,
      icon: <RocketOutlined />,
      iconBg: 'linear-gradient(135deg, #3B82F6, #60A5FA)',
    },
    {
      title: '待审批数',
      value: String(pendingAuditCount),
      extra: <Text className="text-slate-400">{pendingAuditCount} 个待审批 · 0 个即将超时</Text>,
      icon: <AuditOutlined />,
      iconBg: 'linear-gradient(135deg, #F59E0B, #FBBF24)',
    },
    {
      title: '构建成功/失败',
      value: `${successBuilds} / ${failedBuilds}`,
      extra: <StatusTag status={failedBuilds > 0 ? 'danger' : 'success'}>{failedBuilds} 失败 需关注</StatusTag>,
      icon: <BuildOutlined />,
      iconBg: 'linear-gradient(135deg, #EF4444, #F87171)',
    },
    {
      title: 'Commit 合规率',
      value: `${complianceRate}%`,
      extra: <Progress percent={complianceRate} size="small" showInfo={false} />,
      icon: <FileSearchOutlined />,
      iconBg: 'linear-gradient(135deg, #6366F1, #818CF8)',
    },
  ];

  const todoList = pendingAuditCount > 0
    ? releases
        .filter((r) => r.status === 'pending' || r.status === 'auditing')
        .slice(0, 5)
        .map((r) => ({
          title: `审批发布 ${r.version}`,
          applicant: r.publisher,
          time: r.created_at?.split('T')[0] || '',
        }))
    : [
        { title: '暂无待审批任务', applicant: '系统', time: '' },
      ];

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
            style={{ minHeight: 320 }}
            extra={
              <div className="flex items-center gap-4">
                <Text className="text-slate-400 text-sm">最近 10 条发布记录</Text>
                <Button type="text" onClick={() => navigate('/releases')}>查看全部 <RightOutlined /></Button>
              </div>
            }
          >
            <TsList
              dataSource={recentReleases}
              renderItem={(item) => (
                <div className="flex items-center justify-between w-full py-3">
                  <div className="flex items-center gap-4">
                    <Text className="font-medium text-slate-900 w-32">{item.version}</Text>
                    <Text className="text-slate-500 w-32">{item.project_name || '-'}</Text>
                    <StatusTag status={item.release_type === 'formal' ? 'primary' : 'warning'}>
                      {item.release_type === 'formal' ? '正式' : '测试'}
                    </StatusTag>
                    <StatusTag status={item.status === 'released' ? 'success' : 'warning'}>
                      {item.status === 'released' ? '已发布' : item.status}
                    </StatusTag>
                  </div>
                  <Text className="text-slate-400">{item.created_at?.split('T')[0]}</Text>
                </div>
              )}
            />
          </TsCard>
        </Col>

        <Col xs={24} lg={8}>
          <TsCard title="我的待办">
            <TsList
              dataSource={todoList}
              renderItem={(item) => (
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
                  <Button type="link" onClick={() => navigate('/workflows')}>去审批</Button>
                </div>
              )}
            />
          </TsCard>

          <TsCard title="非法提交预警" bodyStyle={{ padding: 20 }}>
            <div className="flex items-center gap-4">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-2xl"
                style={{ background: 'linear-gradient(135deg, #F59E0B, #FBBF24)' }}
              >
                <WarningOutlined />
              </div>
              <div className="flex-1">
                <Title level={3} className="!m-0 !text-slate-900">{illegalCommits}</Title>
                <Text className="text-slate-500">待处理的不合规 commit</Text>
              </div>
              <Button type="default" onClick={() => navigate('/commits/alerts')}>查看</Button>
            </div>
          </TsCard>
        </Col>
      </Row>
    </div>
  );
}
