import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Tabs, Typography, Empty, Button } from 'antd';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { OverviewTab } from './tabs/OverviewTab';
import { RepoTab } from './tabs/RepoTab';
import { MemberTab } from './tabs/MemberTab';
import { WorkflowTab } from './tabs/WorkflowTab';
import { RuleTab } from './tabs/RuleTab';
import { JenkinsTab } from './tabs/JenkinsTab';
import { ReleaseTab } from './tabs/ReleaseTab';
import { projectApi } from '@/api/project';

const { Title, Text } = Typography;

const tabItems = [
  { key: 'overview', label: '基本信息' },
  { key: 'repos', label: '仓库' },
  { key: 'jenkins', label: 'Jenkins' },
  { key: 'members', label: '成员' },
  { key: 'releases', label: '发布' },
  { key: 'workflows', label: '审批流' },
  { key: 'rules', label: '规则配置' },
];

export default function ProjectDetail() {
  const { id, tab = 'overview' } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(tab);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectApi.getProject(id || ''),
    enabled: !!id,
  });

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    navigate(`/projects/${id}/${key}`, { replace: true });
  };

  if (isLoading) {
    return <div className="p-6 text-center">加载中...</div>;
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Empty description="项目不存在" />
        <Button type="primary" className="mt-4" onClick={() => navigate('/projects')}>
          返回项目列表
        </Button>
      </div>
    );
  }

  const isActive = project.status === 1 || project.status === 'active';

  return (
    <div className="space-y-4">
      <TsCard bodyStyle={{ padding: 0 }}>
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
          <div>
            <Title level={4} className="m-0! text-slate-900!">{project.name}</Title>
            <Text className="text-xs text-slate-500 mt-0.5 block">
              {project.code} · 负责人：{project.leader_name || '-'}
            </Text>
          </div>
          <StatusTag status={isActive ? 'success' : 'neutral'}>
            {isActive ? '启用' : '停用'}
          </StatusTag>
        </div>

        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          items={tabItems}
          tabBarStyle={{
            padding: '0 16px',
            marginBottom: 0,
            background: 'rgba(248, 250, 252, 0.5)',
            borderBottom: '1px solid #F1F5F9',
          }}
        />

        <div className="p-6">
          {activeTab === 'overview' && <OverviewTab project={project} />}
          {activeTab === 'repos' && <RepoTab projectId={id || ''} />}
          {activeTab === 'jenkins' && <JenkinsTab projectId={id || ''} />}
          {activeTab === 'members' && <MemberTab projectId={id || ''} />}
          {activeTab === 'releases' && <ReleaseTab projectId={id || ''} />}
          {activeTab === 'workflows' && <WorkflowTab project={project} />}
          {activeTab === 'rules' && <RuleTab project={project} />}
        </div>
      </TsCard>
    </div>
  );
}
