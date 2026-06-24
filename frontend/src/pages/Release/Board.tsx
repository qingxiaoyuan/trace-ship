import { useState } from 'react';
import { Table, Button, Space, message, Tabs } from 'antd';
import type { Dayjs } from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { EyeOutlined, FilePdfOutlined, FileWordOutlined } from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { StatusTag, type StatusType } from '@/components/StatusTag';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { releaseStatusOptions, releaseTypeOptions } from '@/mock/dashboard';
import { releaseApi } from '@/api/release';
import { projectApi } from '@/api/project';

const statusMap: Record<string, { status: StatusType; text: string }> = {
  draft: { status: 'neutral', text: '草稿' },
  pending: { status: 'warning', text: '待审批' },
  building: { status: 'warning', text: '构建中' },
  auditing: { status: 'info', text: '审批中' },
  released: { status: 'success', text: '已发布' },
  rejected: { status: 'danger', text: '已驳回' },
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

export default function ReleaseBoard() {
  const [filters, setFilters] = useState({
    project_id: undefined as string | undefined,
    version: '',
    release_type: undefined as string | undefined,
    status: undefined as string | undefined,
    created_at__gte: undefined as Dayjs | undefined,
    created_at__lte: undefined as Dayjs | undefined,
  });
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [activeTab, setActiveTab] = useState('list');

  const { data: projectData } = useQuery({
    queryKey: ['release-board-projects'],
    queryFn: () => projectApi.getProjects({ page_size: 1000 }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['releases', filters, pagination.current, pagination.pageSize],
    queryFn: () =>
      releaseApi.getReleases({
        page: pagination.current,
        page_size: pagination.pageSize,
        project_id: filters.project_id || undefined,
        version: filters.version || undefined,
        release_type: filters.release_type || undefined,
        status: filters.status || undefined,
        created_at__gte: filters.created_at__gte?.format('YYYY-MM-DD 00:00:00') || undefined,
        created_at__lte: filters.created_at__lte?.format('YYYY-MM-DD 23:59:59') || undefined,
      }),
  });

  const { data: catalogData, isLoading: catalogLoading } = useQuery({
    queryKey: ['release-catalog'],
    queryFn: () => releaseApi.getCatalog(),
    enabled: activeTab === 'catalog',
  });

  const projectOptions = (projectData?.results || []).map((p) => ({ label: p.name, value: p.id }));

  const handleExportPdf = async (id: string, version: string) => {
    try {
      const blob = await releaseApi.exportPdf(id);
      downloadBlob(blob, `${version}_发布单.pdf`);
      message.success('PDF 导出成功');
    } catch {
      message.error('PDF 导出失败');
    }
  };

  const handleExportWord = async (id: string, version: string) => {
    try {
      const blob = await releaseApi.exportWord(id);
      downloadBlob(blob, `${version}_发布单.docx`);
      message.success('Word 导出成功');
    } catch {
      message.error('Word 导出失败');
    }
  };

  const columns = [
    { title: '版本号', dataIndex: 'version' },
    { title: '项目', dataIndex: 'project_name' },
    {
      title: '发布类型',
      dataIndex: 'release_type',
      render: (type: string) => (
        <StatusTag status={type === 'formal' ? 'primary' : 'warning'}>
          {type === 'formal' ? '正式' : '测试'}
        </StatusTag>
      ),
    },
    { title: '来源分支', dataIndex: 'source_branch' },
    { title: '发布人', dataIndex: 'publisher' },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      render: (text: string) => text?.replace('T', ' ').slice(0, 16),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (status: string) => {
        const item = statusMap[status];
        return <StatusTag status={item.status}>{item.text}</StatusTag>;
      },
    },
    {
      title: '操作',
      width: 220,
      render: (_: unknown, record: { id: string; version: string }) => (
        <Space size="small">
          <Button type="text" icon={<EyeOutlined />}>详情</Button>
          <Button type="text" icon={<FilePdfOutlined />} onClick={() => handleExportPdf(record.id, record.version)}>PDF</Button>
          <Button type="text" icon={<FileWordOutlined />} onClick={() => handleExportWord(record.id, record.version)}>Word</Button>
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
              options: projectOptions,
            },
            { key: 'version', type: 'input', placeholder: '版本号', width: 160 },
            {
              key: 'release_type',
              type: 'select',
              placeholder: '发布类型',
              width: 128,
              options: releaseTypeOptions,
            },
            {
              key: 'status',
              type: 'select',
              placeholder: '状态',
              width: 128,
              options: releaseStatusOptions,
            },
            { key: 'created_at__gte', type: 'date', placeholder: '开始日期', width: 160 },
            { key: 'created_at__lte', type: 'date', placeholder: '结束日期', width: 160 },
          ]}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onSearch={() => setPagination((prev) => ({ ...prev, current: 1 }))}
          onReset={() => {
            setFilters({
              project_id: undefined,
              version: '',
              release_type: undefined,
              status: undefined,
              created_at__gte: undefined,
              created_at__lte: undefined,
            });
            setPagination((prev) => ({ ...prev, current: 1 }));
          }}
        />
      </TsCard>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        {
          key: 'list',
          label: '发布记录',
          children: (
            <TsCard title="发布记录">
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
          ),
        },
        {
          key: 'catalog',
          label: '版本目录',
          children: (
            <TsCard title="版本目录">
              <Tabs
                items={[
                  {
                    key: 'formal',
                    label: '正式版本',
                    children: (
                      <Table
                        rowKey="id"
                        columns={columns.filter((c) => c.dataIndex !== 'release_type')}
                        dataSource={catalogData?.formal || []}
                        loading={catalogLoading}
                        pagination={false}
                      />
                    ),
                  },
                  {
                    key: 'test',
                    label: '测试版本',
                    children: (
                      <Table
                        rowKey="id"
                        columns={columns.filter((c) => c.dataIndex !== 'release_type')}
                        dataSource={catalogData?.test || []}
                        loading={catalogLoading}
                        pagination={false}
                      />
                    ),
                  },
                ]}
              />
            </TsCard>
          ),
        },
      ]} />
    </div>
  );
}
