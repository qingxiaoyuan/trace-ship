import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Empty, Typography, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { TsCard } from '@/components/TsCard';
import { StatusTag } from '@/components/StatusTag';
import { getCommitById, getAIReviewByCommitId } from '@/mock/dashboard';
import type { ReviewStatus } from '@/types';

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

function parseCommitMessage(message: string) {
  const result: Record<string, unknown> = { raw: message };
  const typeMatch = message.match(/变更类型[：:]\s*([A-Z类-]+)/);
  const contentMatch = message.match(/更新内容[：:]\s*([\s\S]+)$/);
  if (typeMatch) result.changeType = typeMatch[1].trim();
  if (contentMatch) result.content = contentMatch[1].trim();
  if (message.startsWith('[System]')) {
    result.type = 'System Config';
    result.content = message.replace('[System]', '').trim();
  }
  if (Object.keys(result).length === 1) {
    result.note = '未识别到规范格式';
  }
  return result;
}

function InfoItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50/60 border border-slate-100 p-4">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export default function CommitDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const commit = useMemo(() => (id ? getCommitById(id) : undefined), [id]);
  const aiReview = useMemo(() => (id ? getAIReviewByCommitId(id) : undefined), [id]);

  if (!commit) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Empty description="提交记录不存在" />
        <Button type="primary" className="mt-4" onClick={() => navigate('/commits')}>
          返回列表
        </Button>
      </div>
    );
  }

  const parsedMessage = parseCommitMessage(commit.message);
  const reviewItem = reviewStatusMap[commit.review_status];
  const changeTypeStatus = changeTypeStatusMap[commit.change_type] || 'neutral';

  return (
    <div className="space-y-4">
      <TsCard bodyStyle={{ padding: 20 }}>
        <div className="flex items-center justify-between">
          <div>
            <Title level={5} className="m-0! text-slate-900!">查看详情</Title>
            <Text className="text-sm text-slate-500">查看单条提交的规范审查明细</Text>
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
          <InfoItem label="分支">
            <span className="font-mono text-xs text-slate-700">{commit.branch}</span>
          </InfoItem>
          <InfoItem label="变更类型">
            <StatusTag status={changeTypeStatus}>
              {commit.change_type === '-' ? '-' : commit.change_type}
            </StatusTag>
          </InfoItem>
          <InfoItem label="合规状态">
            <StatusTag status={reviewItem.status}>{reviewItem.text}</StatusTag>
          </InfoItem>
        </div>
      </TsCard>

      <TsCard title="原始 Commit Message">
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 font-mono text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
          {commit.message}
        </div>
      </TsCard>

      <TsCard title="解析结果">
        <pre className="p-4 rounded-xl bg-slate-50 border border-slate-100 font-mono text-sm text-slate-700 leading-relaxed overflow-auto">
          {JSON.stringify(parsedMessage, null, 2)}
        </pre>
      </TsCard>

      <TsCard
        className="border border-violet-100 bg-linear-to-r from-white to-violet-50/30"
        title="AI 审查建议"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center shrink-0">
            AI
          </div>
          <div className="flex-1">
            <div className="text-sm text-slate-700 leading-relaxed">
              {aiReview?.conclusion || commit.ai_suggestion || '暂无 AI 审查建议。'}
            </div>
          </div>
        </div>
      </TsCard>

      <div className="flex justify-end gap-3">
        <Button onClick={() => message.success('已标记为不合规')}>标记为不合规</Button>
        <Button type="primary" onClick={() => message.success('已标记为合规')}>
          标记为合规
        </Button>
      </div>
    </div>
  );
}
