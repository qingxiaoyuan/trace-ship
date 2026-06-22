import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs, Button, Typography } from 'antd';
import { ArrowLeftOutlined, EditOutlined } from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { OverviewTab } from './tabs/OverviewTab';
import { RepoTab } from './tabs/RepoTab';
import { MemberTab } from './tabs/MemberTab';
import { WorkflowTab } from './tabs/WorkflowTab';
import { ReleaseTab } from './tabs/ReleaseTab';
import { RuleTab } from './tabs/RuleTab';
import { IntegrationTab } from './tabs/IntegrationTab';

const { Title, Text } = Typography;

const tabItems = [
  { key: 'overview', label: '基本信息' },
  { key: 'repos', label: '仓库' },
  { key: 'members', label: '成员' },
  { key: 'workflows', label: '审批流' },
  { key: 'releases', label: '发布记录' },
  { key: 'rules', label: '规则配置' },
  { key: 'integrations', label: '外站绑定' },
];

export default function ProjectDetail() {
  const { id, tab = 'overview' } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(tab);

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    navigate(`/projects/${id}/${key}`, { replace: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')}>返回</Button>
          <div>
            <Title level={4} className="!m-0">核心交易平台</Title>
            <Text className="text-slate-400">CORE_TRADE · 创建于 2026-01-15</Text>
          </div>
          <StatusTag status="success">启用</StatusTag>
        </div>
        <Button type="primary" icon={<EditOutlined />}>编辑</Button>
      </div>

      <TsCard bodyStyle={{ padding: 0 }}>
        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          items={tabItems}
          tabBarStyle={{ padding: '0 20px', marginBottom: 0, borderBottom: '1px solid #E2E8F0' }}
        />
        <div className="p-6">
          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'repos' && <RepoTab />}
          {activeTab === 'members' && <MemberTab />}
          {activeTab === 'workflows' && <WorkflowTab />}
          {activeTab === 'releases' && <ReleaseTab />}
          {activeTab === 'rules' && <RuleTab />}
          {activeTab === 'integrations' && <IntegrationTab />}
        </div>
      </TsCard>
    </div>
  );
}
