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
  const [editedProxies, setEditedProxies] = useState<string | null>(null);
  const { data, isError, isLoading } = useQuery({
    queryKey,
    queryFn: systemApi.getDownloadPolicy,
  });
  const value = edited ?? data?.allowed_cidrs ?? '';
  const proxies = editedProxies ?? data?.trusted_proxy_cidrs ?? '';
  const save = useMutation({
    mutationFn: systemApi.saveDownloadPolicy,
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKey, saved);
      setEdited(null);
      setEditedProxies(null);
      message.success('下载白名单已保存');
      void useAuthStore.getState().fetchUserInfo().catch(() => undefined);
    },
  });
  const readOnly = data?.can_edit !== true || isError;
  const validationErrors = (save.error as NormalizedError | null)?.data as {
    allowed_cidrs?: string[];
    trusted_proxy_cidrs?: string[];
  } | undefined;
  const cidrError = validationErrors?.allowed_cidrs?.[0];
  const proxyError = validationErrors?.trusted_proxy_cidrs?.[0];

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
          onClick={() => save.mutate({
            allowed_cidrs: value,
            trusted_proxy_cidrs: editedProxies ?? undefined,
          })}
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
      </p>
      <label htmlFor="download-trusted-proxies" className="block text-[12px] font-medium text-slate-600">
        可信上游代理 IP（直连可留空）
      </label>
      <Input.TextArea
        id="download-trusted-proxies"
        value={proxies}
        disabled={readOnly || save.isPending}
        status={proxyError ? 'error' : undefined}
        aria-describedby={proxyError ? 'download-trusted-proxies-error' : 'download-trusted-proxies-help'}
        rows={2}
        placeholder="每行一个固定 IP"
        onChange={(event) => {
          setEditedProxies(event.target.value);
          if (save.isError) save.reset();
        }}
      />
      {proxyError && <p id="download-trusted-proxies-error" role="alert" className="text-[12px] text-rose-600">{proxyError}</p>}
      <p id="download-trusted-proxies-help" className="text-[12px] text-slate-500">
        经 OA 等网关访问时，请填写保留真实客户端 IP 的网关固定地址。下载白名单不要包含代理或网关地址。
        应用自带的 Nginx 会自动识别。
      </p>
      {isError || (!isLoading && readOnly) ? (
        <p className="text-[12px] text-slate-500">
          {isError ? '下载白名单加载失败。' : '请连接下载策略管理网段后修改。'}
        </p>
      ) : null}
    </section>
  );
}
