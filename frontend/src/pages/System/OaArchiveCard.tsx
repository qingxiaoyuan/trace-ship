import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Input } from 'antd';
import { systemApi } from '@/api/system';
import { PermissionAlert } from '@/components/PermissionAlert';

/** 软件归档使用独立配置，只保存地址，不发起外部请求。 */
export function OaArchiveCard() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [edited, setEdited] = useState<string>();
  const config = useQuery({ queryKey: ['system-configs', 'oa-archive'], queryFn: systemApi.getOaArchiveConfig });
  const url = edited ?? config.data?.url ?? '';
  const save = useMutation({
    mutationFn: () => systemApi.saveOaArchiveConfig(url.trim()),
    onSuccess: (data) => {
      queryClient.setQueryData(['system-configs', 'oa-archive'], data);
      setEdited(undefined);
      void queryClient.invalidateQueries({ queryKey: ['system-configs'] });
      message.success('OA 软件归档配置已保存');
    },
  });
  return <section aria-label="OA 软件归档" className="tech-card flex flex-col gap-3 rounded-xl px-5 py-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-[14px] font-semibold text-slate-900">OA 软件归档</h2>
      <Button onClick={() => save.mutate()} loading={save.isPending} disabled={config.isPending || !!config.error}>保存归档配置</Button>
    </div>
    <p className="text-[12px] text-slate-500">填写完整归档接口地址，供已发布正式版的单产物手动申请使用；与 OA 单点登录分别配置。</p>
    {config.error ? <><PermissionAlert error={config.error} /><Button onClick={() => void config.refetch()}>重新加载归档配置</Button></> : <>
      <label htmlFor="oa-archive-url" className="block text-[12px] text-slate-600">归档接口完整地址</label>
      <Input id="oa-archive-url" value={url} onChange={event => setEdited(event.target.value)} disabled={config.isPending}
        placeholder="https://oa.example.com/api/v1/ticketscript/create_software_archive_with_number" />
      {!config.isPending && !config.data?.url && <Alert type="warning" showIcon title="尚未配置归档接口，申请资料可先准备，不能发送 OA。" />}
    </>}
    {save.error && <PermissionAlert error={save.error} errorTitle="归档配置保存失败" />}
  </section>;
}
