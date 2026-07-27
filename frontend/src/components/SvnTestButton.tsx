import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, App } from 'antd';
import { Activity, CheckCircle2, XCircle } from 'lucide-react';
import { packageApi } from '@/api/package';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

interface SvnTestButtonProps {
  projectId?: string;
  svnUrl?: string | null;
  svnCredentialId?: string | null;
  svnPathTemplate?: string | null;
  disabled?: boolean;
}

export function SvnTestButton({
  projectId,
  svnUrl,
  svnCredentialId,
  svnPathTemplate,
  disabled,
}: SvnTestButtonProps) {
  const { message } = App.useApp();
  const [status, setStatus] = useState<TestStatus>('idle');

  const mutation = useMutation({
    mutationFn: () => {
      if (!projectId || !svnUrl?.trim() || !svnCredentialId) {
        return Promise.reject(new Error('请先填写 SVN 仓库地址和凭证'));
      }
      return packageApi.testSvn({
        project_id: projectId,
        svn_url: svnUrl.trim(),
        svn_credential_id: svnCredentialId,
        svn_path_template: svnPathTemplate?.trim(),
      });
    },
    onSuccess: (res) => {
      setStatus('success');
      message.success(res.message || 'SVN 连接测试成功');
    },
    onError: (err: { message?: string }) => {
      setStatus('error');
      message.error(err.message || 'SVN 连接测试失败');
    },
  });

  const icon =
    status === 'success' ? (
      <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />
    ) : status === 'error' ? (
      <XCircle className="h-4 w-4" strokeWidth={1.5} />
    ) : (
      <Activity className="h-4 w-4" strokeWidth={1.5} />
    );

  const label = mutation.isPending
    ? '测试中…'
    : status === 'success'
      ? '连接成功'
      : status === 'error'
        ? '连接失败'
        : '测试连接';

  return (
    <Button
      type={status === 'success' ? 'primary' : status === 'error' ? 'primary' : 'default'}
      danger={status === 'error'}
      ghost={status === 'success'}
      loading={mutation.isPending}
      disabled={disabled || !projectId || !svnUrl || !svnCredentialId}
      icon={icon}
      onClick={() => {
        setStatus('testing');
        mutation.mutate();
      }}
    >
      {label}
    </Button>
  );
}
