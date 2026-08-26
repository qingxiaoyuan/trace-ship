import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Result, Spin } from 'antd';
import { useAuthStore } from '@/stores/authStore';

/** 从 SSO 登录接口错误中提取面向用户的提示（认证接口返回原始 {code, message} 响应体） */
function extractErrorMessage(error: unknown): string {
  const body = error as { message?: unknown } | undefined;
  if (body && typeof body.message === 'string' && body.message) {
    return body.message;
  }
  return '单点登录失败，请从 OA 重新进入';
}

/**
 * EKP OA 单点登录入口页
 *
 * OA 门户跳转地址形如 /sso?token=xxx，本页面取出一次性 token 调后端验票登录：
 * 成功写入登录态并跳工作台；失败展示原因（token 已使用/已过期等）并引导重新进入。
 */
export default function SsoEntry() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const ssoLogin = useAuthStore((state) => state.ssoLogin);
  const [error, setError] = useState('');
  // StrictMode 下 effect 会执行两次，token 为一次性凭证，需防重复验票
  const startedRef = useRef(false);

  const token = searchParams.get('token')?.trim() ?? '';

  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    ssoLogin(token)
      .then(() => navigate('/dashboard', { replace: true }))
      .catch((e) => setError(extractErrorMessage(e)));
  }, [token, ssoLogin, navigate]);

  if (error) {
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-slate-50">
        <Result
          status="warning"
          title="单点登录失败"
          subTitle={`${error}，请从 OA 门户重新进入，或使用账号密码登录。`}
          extra={
            <Button type="primary" onClick={() => navigate('/login', { replace: true })}>
              前往登录页
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-4 bg-slate-50">
      <Spin size="large" />
      <div className="text-[13px] text-slate-500">正在通过 OA 单点登录…</div>
    </div>
  );
}
