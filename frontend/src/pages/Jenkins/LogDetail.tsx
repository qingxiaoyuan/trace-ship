import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Card } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { StatusTag } from '@/components/StatusTag';
import { mockBuildRecords, mockBuildLog } from '@/mock/dashboard';
import { tokens } from '@/styles/theme';

const statusMap: Record<
  string,
  { status: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; text: string }
> = {
  queue: { status: 'info', text: '排队中' },
  building: { status: 'warning', text: '构建中' },
  success: { status: 'success', text: '成功' },
  failure: { status: 'danger', text: '失败' },
  aborted: { status: 'neutral', text: '中止' },
};

export default function JenkinsLogDetail() {
  const { buildId } = useParams<{ buildId: string }>();
  const navigate = useNavigate();

  const build = useMemo(() => {
    return mockBuildRecords.find((b) => b.id === buildId) || null;
  }, [buildId]);

  if (!build) {
    return (
      <div className="ts-fade-in-up p-6 text-center" style={{ color: tokens.colors.textSecondary }}>
        未找到对应的构建记录
      </div>
    );
  }

  const statusItem = statusMap[build.status];

  return (
    <div className="space-y-5 ts-fade-in-up">
      <div className="flex items-center justify-between">
        <div>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/jenkins')}
            style={{ color: tokens.colors.textSecondary, padding: 0, marginBottom: 8 }}
          >
            返回 Jenkins 构建
          </Button>
          <h1
            className="text-lg font-bold"
            style={{ color: tokens.colors.textPrimary }}
          >
            构建日志 #{build.build_number}
          </h1>
          <p
            className="text-sm mt-0.5"
            style={{ color: tokens.colors.textSecondary }}
          >
            {build.job_name} · {build.version} ·{' '}
            {statusItem && <StatusTag status={statusItem.status}>{statusItem.text}</StatusTag>}
          </p>
        </div>
        <div className="text-sm text-right" style={{ color: tokens.colors.textSecondary }}>
          <div>开始时间：{dayjs(build.started_at).format('YYYY-MM-DD HH:mm')}</div>
          <div>耗时：{build.duration || '-'}</div>
        </div>
      </div>

      <Card
        bodyStyle={{ padding: 0 }}
        style={{
          borderRadius: tokens.layout.cardRadius,
          border: `1px solid ${tokens.colors.border}`,
          boxShadow: tokens.shadow.card,
          overflow: 'hidden',
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: tokens.colors.border, background: tokens.colors.surface }}
        >
          <div className="flex items-center gap-3">
            {build.status === 'building' && (
              <span
                className="w-2 h-2 rounded-full ts-pulse-soft"
                style={{ background: tokens.colors.warning }}
              />
            )}
            <span className="font-semibold text-sm" style={{ color: tokens.colors.textPrimary }}>
              控制台输出
            </span>
          </div>
          {build.status === 'building' && (
            <span
              className="text-xs font-mono px-2 py-0.5 rounded"
              style={{
                background: tokens.colors.neutralSoft,
                color: tokens.colors.textSecondary,
              }}
            >
              实时刷新
            </span>
          )}
        </div>
        <pre
          className="log-console p-4 overflow-auto font-mono text-sm leading-relaxed"
          style={{ height: 480 }}
        >
          {mockBuildLog}
        </pre>
      </Card>
    </div>
  );
}
