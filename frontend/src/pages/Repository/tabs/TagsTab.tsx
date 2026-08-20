import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input, Modal, Typography } from 'antd';
import { Tag, Trash2 } from 'lucide-react';
import dayjs from 'dayjs';
import { repositoryApi } from '@/api/repository';
import { useAppMessage } from '@/hooks/useAppMessage';

interface TagsTabProps {
  repoId: string;
  repoType: 'git' | 'svn';
}

/** 标签 Tab：Git 仓库展示标签列表并支持删除（需输入完整 tag 名称二次确认），SVN 仓库提示不支持 */
export function TagsTab({ repoId, repoType }: TagsTabProps) {
  const queryClient = useQueryClient();
  const { message } = useAppMessage();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['repository-tags', repoId],
    queryFn: () => repositoryApi.getTags(repoId),
  });

  const handleDelete = async () => {
    if (!deleteTarget || deleteInput !== deleteTarget) return;
    setDeleting(true);
    try {
      await repositoryApi.deleteTag(repoId, deleteInput);
      message.success(`标签 ${deleteTarget} 已删除`);
      setDeleteTarget(null);
      setDeleteInput('');
      queryClient.invalidateQueries({ queryKey: ['repository-tags', repoId] });
    } catch (err) {
      // 删除失败由全局拦截器统一提示
      console.error(err);
    } finally {
      // 无论成败都要复位 loading，否则本组件常驻、下一次删除按钮会一直转圈
      setDeleting(false);
    }
  };

  if (repoType === 'svn') {
    return (
      <div className="py-8 text-center text-[13px] text-slate-400">
        SVN 仓库不支持标签管理
      </div>
    );
  }

  const tags = data || [];

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {isLoading ? (
          <div className="col-span-full py-6 text-center text-[13px] text-slate-400">加载中…</div>
        ) : tags.length === 0 ? (
          <div className="col-span-full py-6 text-center text-[13px] text-slate-400">暂无标签</div>
        ) : (
          tags.map((t, idx) => {
            const iconClass = ['icon-emerald', 'icon-cyan', 'icon-amber', 'icon-indigo', 'icon-violet'][idx % 5];
            return (
              <div
                key={t.name}
                className="flex items-center gap-3 rounded-lg border border-indigo-100 bg-white p-3 transition-colors hover:border-indigo-300"
              >
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconClass}`}>
                  <Tag className="h-4 w-4" strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <div className="font-mono text-[13px] font-medium text-slate-900">{t.name}</div>
                  <div className="text-[11px] text-slate-400">
                    {t.commit_hash ? t.commit_hash.slice(0, 8) : '-'}
                    {t.created_at ? ` · ${dayjs(t.created_at).format('YYYY-MM-DD')}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  title={`删除标签 ${t.name}`}
                  onClick={() => {
                    setDeleteTarget(t.name);
                    setDeleteInput('');
                  }}
                  className="rounded-md p-2 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* 删除二次确认：需输入完整 tag 名称 */}
      <Modal
        title="删除标签"
        open={deleteTarget !== null}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteInput('');
        }}
        okText="确认删除"
        okButtonProps={{
          danger: true,
          disabled: deleteInput !== deleteTarget,
          loading: deleting,
        }}
        cancelText="取消"
        onOk={handleDelete}
      >
        <div className="space-y-3 py-1">
          <Typography.Paragraph className="mb-0 text-[13px] text-slate-600">
            此操作将删除远程 Tag，<b>不可恢复</b>。
          </Typography.Paragraph>
          <div className="rounded-lg border border-rose-100 bg-rose-50/50 p-2.5 text-[12px] text-rose-600">
            请输入 Tag 名称 <span className="font-mono font-semibold">{deleteTarget}</span>{' '}
            以确认删除
          </div>
          <Input
            value={deleteInput}
            onChange={(e) => setDeleteInput(e.target.value)}
            placeholder="请输入完整 Tag 名称"
            onPressEnter={handleDelete}
            status={deleteInput && deleteInput !== deleteTarget ? 'error' : undefined}
            autoFocus
          />
        </div>
      </Modal>
    </>
  );
}
