import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Input } from 'antd';
import { Highlighter, Save } from 'lucide-react';
import { systemApi } from '@/api/system';

/** 变更文档高亮关键字的配置键（is_public，登录用户可读） */
const KEYWORD_CONFIG_KEY = 'review_doc_highlight_keywords';

/** 系统配置页面：审查关键字维护卡片（审查员查看变更文档时纯前端高亮） */
export function ReviewKeywordCard() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  // 编辑态内容；为 null 时展示已保存的配置值（避免在 effect 里 setState）
  const [edited, setEdited] = useState<string | null>(null);

  // 列表接口按 key 精确查找该配置是否存在（决定保存走新建还是更新）
  const { data, isLoading } = useQuery({
    queryKey: ['system-configs', 'keyword-card', KEYWORD_CONFIG_KEY],
    queryFn: () => systemApi.getConfigs({ keyword: KEYWORD_CONFIG_KEY, page: 1, page_size: 20 }),
  });
  const existing = (data?.results || []).find((c) => c.key === KEYWORD_CONFIG_KEY);
  const keywords = edited ?? existing?.value ?? '';

  const saveMutation = useMutation({
    mutationFn: () =>
      existing
        ? systemApi.patchConfig(KEYWORD_CONFIG_KEY, { value: keywords, is_public: true })
        : systemApi.createConfig({
            key: KEYWORD_CONFIG_KEY,
            value: keywords,
            description: '审查员查看变更文档时高亮的关键字（换行或逗号分隔，纯前端生效）',
            is_public: true,
          }),
    onSuccess: () => {
      message.success('审查关键字已保存');
      setEdited(null);
      queryClient.invalidateQueries({ queryKey: ['system-configs'] });
      queryClient.invalidateQueries({ queryKey: ['system-public-configs'] });
    },
  });

  return (
    <div className="tech-card rounded-xl px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg icon-amber">
            <Highlighter className="h-3.5 w-3.5" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-slate-900">审查关键字高亮</div>
            <div className="text-[11px] text-slate-400">
              审查员在「提交审查 → 已发布回溯」查看变更文档时，命中的关键字自动高亮（纯前端，不影响文档内容）
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || isLoading}
          className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
          保存
        </button>
      </div>

      <div className="mt-4">
        <Input.TextArea
          value={keywords}
          onChange={(e) => setEdited(e.target.value)}
          rows={4}
          placeholder={'每行一个关键字，或用逗号分隔，例如：\n数据库\n接口变更\n配置文件'}
          maxLength={2000}
          disabled={isLoading}
        />
        <p className="mt-1.5 text-[11px] text-slate-400">
          支持换行 / 中英文逗号分隔；留空则关闭高亮。仅审查员（release.audit 权限）查看时生效
        </p>
      </div>
    </div>
  );
}
