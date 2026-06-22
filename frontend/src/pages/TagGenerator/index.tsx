import { useState } from 'react';
import {
  Steps,
  Form,
  Select,
  Radio,
  Button,
  Table,
  Checkbox,
  Tag,
  Input,
  List,
  Row,
  Col,
  Card,
  Space,
  message,
} from 'antd';
import {
  SaveOutlined,
  FileWordOutlined,
  FilePdfOutlined,
  RobotOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { mockCommits } from '@/mock/dashboard';
import type { CommitRecord } from '@/types';

const { TextArea } = Input;

const projectOptions = [{ label: '核心交易平台', value: '1' }];
const repoOptions = [{ label: '后端代码仓库', value: '1' }];
const branchOptions = [{ label: 'develop', value: 'develop' }, { label: 'main', value: 'main' }];
const tagOptions = [{ label: 'v2.4.0', value: 'v2.4.0' }, { label: 'v2.3.9', value: 'v2.3.9' }];

export default function TagGenerator() {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedCommits, setSelectedCommits] = useState<string[]>([]);
  const [form] = Form.useForm();

  const toggleCommit = (id: string) => {
    setSelectedCommits((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    setSelectedCommits((prev) =>
      prev.length === mockCommits.length ? [] : mockCommits.map((c) => c.id)
    );
  };

  const stepContent = [
    <Step1Branch key="step1" form={form} />,
    <Step2Diff
      key="step2"
      selectedCommits={selectedCommits}
      toggleCommit={toggleCommit}
      toggleAll={toggleAll}
    />,
    <Step3Doc key="step3" form={form} />,
  ];

  return (
    <div className="space-y-6">
      <TsCard bodyStyle={{ padding: 24 }}>
        <Steps
          current={currentStep}
          items={[
            { title: '选择项目与分支' },
            { title: '提取并编辑差异' },
            { title: '生成发布说明' },
          ]}
        />
      </TsCard>

      <div className="min-h-[400px]">{stepContent[currentStep]}</div>

      <div className="flex justify-between">
        <Button disabled={currentStep === 0} onClick={() => setCurrentStep((s) => s - 1)}>
          上一步
        </Button>
        <Space>
          {currentStep === 2 && (
            <>
              <Button icon={<SaveOutlined />}>保存草稿</Button>
              <Button icon={<FileWordOutlined />}>导出 Word</Button>
              <Button icon={<FilePdfOutlined />}>导出 PDF</Button>
            </>
          )}
          <Button
            type="primary"
            onClick={() => {
              if (currentStep === 2) {
                message.success('提交审批成功');
              } else {
                setCurrentStep((s) => s + 1);
              }
            }}
          >
            {currentStep === 2 ? '提交审批' : '下一步'}
          </Button>
        </Space>
      </div>
    </div>
  );
}

function Step1Branch({ form }: { form: any }) {
  return (
    <TsCard title="选择发布信息">
      <Form form={form} layout="vertical" className="max-w-2xl">
        <Form.Item name="project_id" label="项目" rules={[{ required: true }]}>
          <Select options={projectOptions} placeholder="选择项目" />
        </Form.Item>
        <Form.Item name="repository_id" label="仓库" rules={[{ required: true }]}>
          <Select options={repoOptions} placeholder="选择仓库" />
        </Form.Item>
        <Form.Item name="source_branch" label="来源分支" rules={[{ required: true }]}>
          <Select options={branchOptions} placeholder="选择来源分支" />
        </Form.Item>
        <Form.Item name="start_tag" label="起始 Tag" rules={[{ required: true }]}>
          <Select options={tagOptions} placeholder="选择起始 Tag" />
        </Form.Item>
        <Form.Item name="release_type" label="发布类型" rules={[{ required: true }]}>
          <Radio.Group>
            <Radio value="formal">正式</Radio>
            <Radio value="test">测试</Radio>
          </Radio.Group>
        </Form.Item>
      </Form>
    </TsCard>
  );
}

function Step2Diff({
  selectedCommits,
  toggleCommit,
  toggleAll,
}: {
  selectedCommits: string[];
  toggleCommit: (id: string) => void;
  toggleAll: () => void;
}) {
  const columns = [
    {
      title: (
        <Checkbox
          checked={selectedCommits.length === mockCommits.length && mockCommits.length > 0}
          indeterminate={selectedCommits.length > 0 && selectedCommits.length < mockCommits.length}
          onChange={toggleAll}
        />
      ),
      width: 60,
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
      render: (hash: string) => <span className="font-mono text-xs">{hash.slice(0, 12)}</span>,
    },
    { title: '作者', dataIndex: 'author' },
    {
      title: '消息摘要',
      dataIndex: 'message',
      render: (text: string) => text?.split('\n')[0],
    },
    {
      title: '变更类型',
      dataIndex: 'change_type',
      render: (type: string) => <Tag color={type === 'A类' ? 'blue' : type === 'F类' ? 'orange' : 'default'}>{type}</Tag>,
    },
    {
      title: '合规状态',
      dataIndex: 'review_status',
      render: (status: string) => (
        <StatusTag status={status === 'pass' ? 'success' : status === 'warning' ? 'warning' : 'danger'}>
          {status === 'pass' ? '合规' : status === 'warning' ? '警告' : '不合规'}
        </StatusTag>
      ),
    },
  ];

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={16}>
        <TsCard
          title={`Commit 差异 (${selectedCommits.length}/${mockCommits.length})`}
          extra={
            <Space>
              <Button icon={<RobotOutlined />}>AI 辅助生成摘要</Button>
              <Button disabled={selectedCommits.length === 0}>合并选中</Button>
              <Button disabled={selectedCommits.length === 0}>排除选中</Button>
            </Space>
          }
        >
          <Table rowKey="id" columns={columns} dataSource={mockCommits} pagination={false} />
        </TsCard>
      </Col>
      <Col xs={24} lg={8} className="space-y-4">
        <TsCard title="差异统计">
          <List
            dataSource={[
              { label: '总 commit 数', value: mockCommits.length },
              { label: 'A 类更新', value: 1 },
              { label: 'F 类更新', value: 1 },
              { label: '配置项改动', value: 1 },
              { label: '不合规提交', value: 1 },
            ]}
            renderItem={(item) => (
              <List.Item className="!px-0 flex justify-between">
                <span className="text-slate-500">{item.label}</span>
                <span className="font-semibold">{item.value}</span>
              </List.Item>
            )}
          />
        </TsCard>

        <Card className="bg-amber-50 border-amber-200">
          <div className="flex items-start gap-3">
            <WarningOutlined className="text-amber-500 text-lg mt-0.5" />
            <div>
              <div className="font-semibold text-amber-800">AI 风险提示</div>
              <div className="text-amber-700 text-sm mt-1">
                检测到 1 条不合规提交，建议整改后再生成发布说明。
              </div>
            </div>
          </div>
        </Card>
      </Col>
    </Row>
  );
}

function Step3Doc({ form }: { form: any }) {
  return (
    <TsCard title="发布说明">
      <Form form={form} layout="vertical" className="max-w-3xl">
        <Form.Item name="version" label="版本号" rules={[{ required: true }]}>
          <Input placeholder="VA.4.1.155" />
        </Form.Item>
        <Form.Item name="tag_name" label="Tag 名称">
          <Input placeholder="VA.4.1.155" />
        </Form.Item>
        <Form.Item name="git_hash" label="Git 哈希">
          <Input placeholder="271b6887..." disabled />
        </Form.Item>
        <Form.Item name="change_type" label="变更类型">
          <Radio.Group>
            <Radio value="none">无配置项改动</Radio>
            <Radio value="config">有配置项改动</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="updates" label="更新内容">
          <List
            dataSource={[
              { type: 'A', content: '移除干扰用户绑定数据采集(DA)的逻辑' },
              { type: 'F', content: '信号定时开关新增清除指令并优化控制逻辑' },
            ]}
            renderItem={(item) => (
              <List.Item className="!px-0">
                <div className="flex gap-2 w-full">
                  <Tag color={item.type === 'A' ? 'blue' : 'orange'}>{item.type}类</Tag>
                  <Input defaultValue={item.content} className="flex-1" />
                </div>
              </List.Item>
            )}
          />
        </Form.Item>
        <Form.Item name="config_changes" label="配置项改动">
          <TextArea rows={3} placeholder="System.DeviceType=0" />
        </Form.Item>
        <Form.Item name="test_status" label="测试验证状态">
          <Checkbox>自测试通过</Checkbox>
        </Form.Item>
        <Form.Item name="publisher" label="发布人">
          <Input placeholder="发布人姓名" />
        </Form.Item>
      </Form>
    </TsCard>
  );
}
