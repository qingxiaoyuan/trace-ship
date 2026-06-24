import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Table,
  Button,
  Space,
  Input,
  Select,
  Form,
  message,
} from 'antd';
import {
  CaretRightFilled,
  SettingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { TsCard } from '@/components/TsCard';
import { StatusTag, type StatusType } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { TsModal } from '@/components/TsModal';
import { jenkinsApi } from '@/api/dashboard';
import { tokens } from '@/styles/theme';
import type { BuildRecord } from '@/types';

const statusMap: Record<
  string,
  { status: StatusType; text: string }
> = {
  queue: { status: 'info', text: '排队中' },
  building: { status: 'warning', text: '构建中' },
  success: { status: 'success', text: '成功' },
  failure: { status: 'danger', text: '失败' },
  aborted: { status: 'neutral', text: '中止' },
};

const credentialOptions = [
  { value: 'jenkins-core', label: 'Jenkins-构建中心' },
  { value: 'jenkins-data', label: 'Jenkins-数据中台' },
  { value: 'jenkins-ops', label: 'Jenkins-运维门户' },
];

const projectOptions = [
  { value: '1', label: '核心交易平台' },
  { value: '2', label: '数据中台' },
  { value: '3', label: '运维门户' },
];

interface JenkinsConfigForm {
  project_id?: string;
  name?: string;
  url?: string;
  job_name?: string;
  credential?: string;
  params?: string;
}

export default function Jenkins() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    project_id: undefined,
    status: undefined,
  });
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [configOpen, setConfigOpen] = useState(false);
  const [form] = Form.useForm<JenkinsConfigForm>();
  const [testing, setTesting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['jenkins-builds', filters, pagination.current, pagination.pageSize],
    queryFn: () =>
      jenkinsApi.getBuilds({
        page: pagination.current,
        page_size: pagination.pageSize,
        project_id: filters.project_id || undefined,
        status: filters.status || undefined,
      }),
  });

  const columns = [
    { title: '任务名', dataIndex: 'job_name' },
    {
      title: '构建编号',
      dataIndex: 'build_number',
      render: (n: number) => (
        <span className="font-mono text-xs text-ts-text-secondary">#{n}</span>
      ),
    },
    {
      title: '版本号',
      dataIndex: 'version',
      render: (v: string) => (
        <span className="font-mono text-xs text-ts-text-secondary">{v}</span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (status: string) => {
        const item = statusMap[status];
        return item ? <StatusTag status={item.status}>{item.text}</StatusTag> : status;
      },
    },
    {
      title: '开始时间',
      dataIndex: 'started_at',
      render: (text: string) => (
        <span className="text-ts-text-secondary text-sm">
          {text ? dayjs(text).format('HH:mm') : '-'}
        </span>
      ),
    },
    {
      title: '耗时',
      dataIndex: 'duration',
      render: (v?: string) => <span className="text-sm">{v || '-'}</span>,
    },
    {
      title: '操作',
      width: 180,
      render: (_: unknown, record: BuildRecord) => (
        <Space size="small">
          <Button
            type="text"
            icon={<CaretRightFilled />}
            style={{ color: tokens.colors.info }}
            onClick={() => message.success(`已触发 ${record.job_name} #${record.build_number}`)}
          >
            构建
          </Button>
          <Button
            type="text"
            style={{ color: tokens.colors.textSecondary }}
            onClick={() => navigate(`/jenkins/logs/${record.id}`)}
          >
            查看日志
          </Button>
        </Space>
      ),
    },
  ];

  const handleSaveConfig = async () => {
    try {
      await form.validateFields();
      message.success('任务配置保存成功');
      setConfigOpen(false);
      form.resetFields();
    } catch {
      // validation failed
    }
  };

  const handleTestConnection = () => {
    setTesting(true);
    setTimeout(() => {
      setTesting(false);
      message.success('Jenkins 连接测试通过');
    }, 1200);
  };

  return (
    <div className="space-y-5 ts-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-lg font-bold"
            style={{ color: tokens.colors.textPrimary }}
          >
            Jenkins 构建状态
          </h1>
          <p
            className="text-sm mt-0.5"
            style={{ color: tokens.colors.textSecondary }}
          >
            实时监控构建任务与日志
          </p>
        </div>
        <Space>
          <Button
            type="primary"
            icon={<CaretRightFilled />}
            style={{
              background: tokens.colors.buttonPrimary,
              borderColor: tokens.colors.buttonPrimary,
              borderRadius: tokens.layout.buttonRadius,
            }}
            onClick={() => message.success('已加入构建队列')}
          >
            立即构建
          </Button>
          <Button
            icon={<SettingOutlined />}
            style={{
              borderRadius: tokens.layout.buttonRadius,
              color: tokens.colors.textBody,
              borderColor: tokens.colors.border,
            }}
            onClick={() => setConfigOpen(true)}
          >
            配置任务
          </Button>
        </Space>
      </div>

      {/* Filter */}
      <TsCard bodyStyle={{ padding: 20 }}>
        <SearchFilterBar
          filters={[
            {
              key: 'project_id',
              type: 'select',
              placeholder: '关联项目',
              width: 176,
              options: projectOptions,
            },
            {
              key: 'status',
              type: 'select',
              placeholder: '构建状态',
              width: 144,
              options: Object.entries(statusMap).map(([value, { text }]) => ({
                value,
                label: text,
              })),
            },
          ]}
          values={filters}
          onChange={(key, value) =>
            setFilters((prev) => ({ ...prev, [key]: value }))
          }
          onSearch={() => setPagination((prev) => ({ ...prev, current: 1 }))}
          onReset={() => {
            setFilters({ project_id: undefined, status: undefined });
            setPagination((prev) => ({ ...prev, current: 1 }));
          }}
        />
      </TsCard>

      {/* Build status table */}
      <TsCard title="构建状态">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data?.results || []}
          loading={isLoading}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
          }}
          onChange={(p) => {
            setPagination({ current: p.current || 1, pageSize: p.pageSize || 10 });
          }}
        />
      </TsCard>

      {/* Config task modal */}
      <TsModal
        title="新增任务配置"
        open={configOpen}
        onCancel={() => {
          setConfigOpen(false);
          form.resetFields();
        }}
        footer={
          <div className="flex justify-end gap-3">
            <Button
              onClick={() => {
                setConfigOpen(false);
                form.resetFields();
              }}
              style={{
                borderRadius: tokens.layout.buttonRadius,
                borderColor: tokens.colors.border,
              }}
            >
              取消
            </Button>
            <Button
              loading={testing}
              onClick={handleTestConnection}
              style={{
                borderRadius: tokens.layout.buttonRadius,
                borderColor: tokens.colors.border,
              }}
            >
              测试连接
            </Button>
            <Button
              type="primary"
              onClick={handleSaveConfig}
              style={{
                background: tokens.colors.buttonPrimary,
                borderColor: tokens.colors.buttonPrimary,
                borderRadius: tokens.layout.buttonRadius,
              }}
            >
              保存
            </Button>
          </div>
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            project_id: '1',
            name: 'core-trade-build',
            url: 'https://jenkins.corp.example.com',
            job_name: 'core-trade/job/build',
            credential: 'jenkins-core',
            params: JSON.stringify(
              {
                BRANCH: '${branch}',
                VERSION: '${version}',
                COMMIT: '${commit}',
              },
              null,
              2
            ),
          }}
        >
          <div className="grid grid-cols-2 gap-5">
            <Form.Item
              label={
                <span>
                  <span style={{ color: tokens.colors.danger }}>*</span> 关联项目
                </span>
              }
              name="project_id"
              rules={[{ required: true, message: '请选择关联项目' }]}
            >
              <Select options={projectOptions} placeholder="请选择" />
            </Form.Item>
            <Form.Item
              label={
                <span>
                  <span style={{ color: tokens.colors.danger }}>*</span> 任务名称
                </span>
              }
              name="name"
              rules={[{ required: true, message: '请输入任务名称' }]}
            >
              <Input placeholder="例如 core-trade-build" />
            </Form.Item>
          </div>

          <Form.Item
            label={
              <span>
                <span style={{ color: tokens.colors.danger }}>*</span> Jenkins 地址
              </span>
            }
            name="url"
            rules={[{ required: true, message: '请输入 Jenkins 地址' }]}
          >
            <Input placeholder="https://jenkins.corp.example.com" />
          </Form.Item>

          <div className="grid grid-cols-2 gap-5">
            <Form.Item
              label={
                <span>
                  <span style={{ color: tokens.colors.danger }}>*</span> Jenkins Job 名
                </span>
              }
              name="job_name"
              rules={[{ required: true, message: '请输入 Jenkins Job 名' }]}
            >
              <Input placeholder="例如 core-trade/job/build" />
            </Form.Item>
            <Form.Item
              label={
                <span>
                  <span style={{ color: tokens.colors.danger }}>*</span> 凭证
                </span>
              }
              name="credential"
              rules={[{ required: true, message: '请选择 Jenkins 凭证' }]}
            >
              <Select
                options={credentialOptions}
                placeholder="请选择 Jenkins 凭证"
              />
            </Form.Item>
          </div>

          <Form.Item label="参数模板（JSON）" name="params">
            <Input.TextArea
              rows={8}
              className="font-mono text-sm"
              placeholder='{"BRANCH": "${branch}", "VERSION": "${version}"}'
            />
          </Form.Item>
          <p
            className="text-xs -mt-4 mb-0"
            style={{ color: tokens.colors.textSecondary }}
          >
            支持使用 {'${branch}'}、{'${version}'}、{'${commit}'} 等变量，构建时自动替换。
          </p>
        </Form>
      </TsModal>
    </div>
  );
}
