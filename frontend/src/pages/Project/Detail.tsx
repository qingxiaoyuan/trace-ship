import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs, Typography, Empty, Button } from 'antd';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { OverviewTab } from './tabs/OverviewTab';
import { RepoTab } from './tabs/RepoTab';
import { MemberTab } from './tabs/MemberTab';
import { WorkflowTab } from './tabs/WorkflowTab';
import { RuleTab } from './tabs/RuleTab';
import { IntegrationTab } from './tabs/IntegrationTab';
import { mockProjects } from '@/mock/projects';

const { Title, Text } = Typography;

const tabItems = [
  { key: 'overview', label: '基本信息' },
  { key: 'repos', label: '仓库' },
  { key: 'members', label: '成员' },
  { key: 'workflows', label: '审批流' },
  { key: 'rules', label: '规则配置' },
  { key: 'integrations', label: '外站绑定' },
];

export default function ProjectDetail() {
  const { id, tab = 'overview' } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(tab);

  const project = useMemo(() => mockProjects.find((p) => p.id === id), [id]);

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    navigate(`/projects/${id}/${key}`, { replace: true });
  };

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

  return (
    <div className="space-y-4">
      <TsCard bodyStyle={{ padding: 0 }}>
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-linear-to-r from-white to-slate-50/50">
          <div>
            <Title level={4} className="m-0! text-slate-900!">{project.name}</Title>
            <Text className="text-xs text-slate-500 mt-0.5 block">
              {project.code} · 负责人：{project.leader_name}
            </Text>
          </div>
          <StatusTag status={project.status === 'active' ? 'success' : 'neutral'}>
            {project.status === 'active' ? '启用' : '停用'}
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
          {activeTab === 'repos' && <RepoTab />}
          {activeTab === 'members' && <MemberTab />}
          {activeTab === 'workflows' && <WorkflowTab />}
          {activeTab === 'rules' && <RuleTab project={project} />}
          {activeTab === 'integrations' && <IntegrationTab />}
        </div>
      </TsCard>
    </div>
  );
}
