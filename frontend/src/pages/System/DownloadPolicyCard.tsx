import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Input } from 'antd';
import type { NormalizedError } from '@/api/request';
import { systemApi } from '@/api/system';
import { useAuthStore } from '@/stores/authStore';

const queryKey = ['system-configs', 'download-policy'];

export function DownloadPolicyCard() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [edited, setEdited] = useState<string | null>(null);
  const { data, isError, isLoading } = useQuery({
    queryKey,
    queryFn: systemApi.getDownloadPolicy,
  });
  const value = edited ?? data?.allowed_cidrs ?? '';
  const save = useMutation({
    mutationFn: systemApi.saveDownloadPolicy,
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKey, saved);
      setEdited(null);
      message.success('下载白名单已保存');
      void useAuthStore.getState().fetchUserInfo().catch(() => undefined);
    },
  });
  const readOnly = data?.can_edit !== true || isError;
  const validationErrors = (save.error as NormalizedError | null)?.data as { allowed_cidrs?: string[] } | undefined;
  const cidrError = validationErrors?.allowed_cidrs?.[0];

  return (
    <section aria-labelledby="download-policy-title" className="tech-card space-y-3 rounded-xl px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="download-policy-title" className="text-[14px] font-semibold text-slate-900">文件下载限制</h2>
          <p className="text-[12px] text-slate-500">白名单外的访问可以使用系统和在线查看，下载与导出仅对允许的网段开放。</p>
        </div>
        <Button
          type="primary"
          loading={save.isPending}
          disabled={readOnly}
          onClick={() => save.mutate(value)}
        >
          保存下载白名单
        </Button>
      </div>
      <label htmlFor="download-allowed-cidrs" className="block text-[12px] font-medium text-slate-600">
        允许下载的 IP 地址或网段
      </label>
      <Input.TextArea
        id="download-allowed-cidrs"
        value={value}
        disabled={readOnly || save.isPending}
        status={cidrError ? 'error' : undefined}
        aria-describedby={cidrError ? 'download-allowed-cidrs-error' : undefined}
        rows={3}
        placeholder="例如 10.20.30.0/24，每行一个网段"
        onChange={(event) => {
          setEdited(event.target.value);
          if (save.isError) save.reset();
        }}
      />
      {cidrError && <p id="download-allowed-cidrs-error" role="alert" className="text-[12px] text-rose-600">{cidrError}</p>}
      <p className="text-[12px] text-slate-500">
        支持 IPv4 和 IPv6，保存后的名单最多 24,576 个字符。留空并保存会禁止所有网络下载。
        {isError ? ' 下载白名单加载失败。' : !isLoading && readOnly ? ' 请连接下载策略管理网段后修改。' : ''}
      </p>
    </section>
  );
}
