import { useParams, useNavigate } from 'react-router-dom';
import { Button, Empty, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { commitApi } from '@/api/dashboard';
import type { AIReviewResult, ReviewStatus } from '@/types';

const { Title, Text } = Typography;

const reviewStatusMap: Record<ReviewStatus, { status: 'success' | 'warning' | 'danger'; text: string }> = {
  pass: { status: 'success', text: '合规' },
  warning: { status: 'warning', text: '警告' },
  illegal: { status: 'danger', text: '不合规' },
};

const changeTypeStatusMap: Record<string, 'info' | 'warning' | 'neutral'> = {
  'A类': 'info',
  'F类': 'warning',
  '-': 'neutral',
};

function InfoItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50/60 border border-slate-100 p-4">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function ScoreBar({ label, value, colorClass }: { label: string; value: number; colorClass: string }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold text-slate-900">{value}%</span>
      </div>
      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${colorClass}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function RiskCard({ result }: { result: AIReviewResult }) {
  const config = {
    low: {
      wrapper: 'bg-emerald-50 border-emerald-100',
      icon: 'bg-emerald-100 text-emerald-600',
      title: '低风险',
      desc: '符合发布要求',
    },
    medium: {
      wrapper: 'bg-amber-50 border-amber-100',
      icon: 'bg-amber-100 text-amber-600',
      title: '中风险',
      desc: '需人工复核',
    },
    high: {
      wrapper: 'bg-red-50 border-red-100',
      icon: 'bg-red-100 text-red-600',
      title: '高风险',
      desc: '不可纳入发布',
    },
  }[result.risk_level];

  return (
    <div className={`rounded-xl border p-4 ${config.wrapper}`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${config.icon}`}>
          <InfoCircleOutlined className="text-lg" />
        </div>
        <div>
          <div className="font-bold text-slate-900">{config.title}</div>
          <div className="text-xs text-slate-600">{config.desc}</div>
        </div>
      </div>
    </div>
  );
}

function SuggestionIcon({ type }: { type: 'success' | 'warning' | 'danger' }) {
  if (type === 'success') {
    return <CheckCircleOutlined className="text-emerald-500 mt-0.5 shrink-0" />;
  }
  if (type === 'danger') {
    return <CloseCircleOutlined className="text-red-500 mt-0.5 shrink-0" />;
  }
  return <ExclamationCircleOutlined className="text-amber-500 mt-0.5 shrink-0" />;
}

export default function CommitAIReview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: commit, isLoading: commitLoading } = useQuery({
    queryKey: ['commit', id],
    queryFn: () => commitApi.getCommit(id || ''),
    enabled: !!id,
  });

  const { data: aiReview, isLoading: reviewLoading } = useQuery({
    queryKey: ['commit-ai-review', id],
    queryFn: () => commitApi.getAiReview(id || '') as Promise<AIReviewResult>,
    enabled: !!id,
  });

  if (commitLoading || reviewLoading) {
    return <div className="p-6 text-center">加载中...</div>;
  }

  if (!commit || !aiReview) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Empty description="未找到该提交的 AI 审查记录" />
        <Button type="primary" className="mt-4" onClick={() => navigate('/commits')}>
          返回列表
        </Button>
      </div>
    );
  }

  const reviewItem = reviewStatusMap[commit.review_status];
  const changeTypeStatus = changeTypeStatusMap[commit.change_type] || 'neutral';
  const barColor =
    commit.review_status === 'pass'
      ? 'bg-violet-500'
      : commit.review_status === 'warning'
      ? 'bg-amber-500'
      : 'bg-red-500';

  return (
    <div className="space-y-4">
      <TsCard bodyStyle={{ padding: 20 }}>
        <div className="flex items-center justify-between">
          <div>
            <Title level={5} className="m-0! text-slate-900!">AI 审查详情</Title>
            <Text className="text-sm text-slate-500">
              AI 对提交规范、风险与影响的综合分析
            </Text>
          </div>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/commits')}>
            返回列表
          </Button>
        </div>
      </TsCard>

      <TsCard title="提交信息">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <InfoItem label="Commit 哈希">
            <span className="font-mono text-sm text-slate-900">{commit.commit_hash.slice(0, 12)}</span>
          </InfoItem>
          <InfoItem label="作者">
            <span className="text-sm text-slate-900">{commit.author}</span>
          </InfoItem>
          <InfoItem label="提交时间">
            <span className="text-sm text-slate-900">{dayjs(commit.committed_at).format('YYYY-MM-DD HH:mm')}</span>
          </InfoItem>
          <InfoItem label="变更类型">
            <StatusTag status={changeTypeStatus}>
              {commit.change_type === '-' ? '-' : commit.change_type}
            </StatusTag>
          </InfoItem>
          <InfoItem label="合规状态">
            <StatusTag status={reviewItem.status}>{reviewItem.text}</StatusTag>
          </InfoItem>
          <InfoItem label="项目 / 仓库">
            <span className="text-sm text-slate-900">
              {commit.project_name} / {commit.repo_name}
            </span>
          </InfoItem>
        </div>
      </TsCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <TsCard
            className="border border-violet-100 bg-linear-to-r from-white to-violet-50/30"
            title="AI 审查结论"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center shrink-0">
                <ThunderboltOutlined className="text-lg" />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-slate-900">AI 审查结论</div>
                <div className="text-sm text-slate-600 leading-relaxed mt-2">{aiReview.conclusion}</div>
              </div>
            </div>
          </TsCard>

          <TsCard title="规范修改建议">
            <ul className="space-y-3">
              {aiReview.suggestions.map((s, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-slate-700 leading-relaxed">
                  <SuggestionIcon type={s.type} />
                  <span>{s.text}</span>
                </li>
              ))}
            </ul>
          </TsCard>

          <TsCard title="关联模块影响分析">
            <div className="space-y-2">
              {aiReview.impacts.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100"
                >
                  <span className="text-sm text-slate-700">{item.module}</span>
                  <StatusTag status={item.level === 'direct' ? 'info' : 'neutral'}>
                    {item.level === 'direct' ? '直接涉及' : '无影响'}
                  </StatusTag>
                </div>
              ))}
            </div>
          </TsCard>
        </div>

        <div className="space-y-4">
          <TsCard title="风险评估">
            <RiskCard result={aiReview} />
          </TsCard>

          <TsCard title="AI 审查指标">
            <ScoreBar
              label="规范完整度"
              value={aiReview.scores.completeness}
              colorClass={barColor}
            />
            <ScoreBar
              label="描述清晰度"
              value={aiReview.scores.clarity}
              colorClass={barColor}
            />
            <ScoreBar
              label="风险可控度"
              value={aiReview.scores.risk_control}
              colorClass={barColor}
            />
          </TsCard>

          <TsCard className="border-l-4 border-l-violet-400 bg-linear-to-r from-violet-50/50 to-white">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center shrink-0">
                <InfoCircleOutlined />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">AI 提示</div>
                <div className="text-xs text-slate-500 mt-1 leading-relaxed">{aiReview.tip}</div>
              </div>
            </div>
          </TsCard>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <Button onClick={() => navigate(`/commits/${id}`)}>查看提交详情</Button>
        <Button onClick={() => {/** noop */}}>重新审查</Button>
        <Button type="primary" onClick={() => {/** noop */}}>采纳建议</Button>
      </div>
    </div>
  );
}
