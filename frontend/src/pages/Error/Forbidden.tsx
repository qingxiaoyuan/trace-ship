import { ShieldX, House, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ForbiddenProps {
  /** 页面标题，默认“没有访问权限” */
  title?: string;
  /** 具体原因说明 */
  description?: string;
}

export default function Forbidden({
  title = '没有访问权限',
  description = '当前账号无权访问该页面，如需开通权限请联系系统管理员。',
}: ForbiddenProps) {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="tech-card w-full max-w-[480px] rounded-2xl p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl icon-amber">
          <ShieldX className="h-7 w-7" strokeWidth={1.5} />
        </div>

        <h1 className="mt-5 text-[20px] font-semibold tracking-tight text-slate-900">
          {title}
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-slate-500">{description}</p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-[13px] text-slate-600 transition-colors hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
            返回上页
          </button>
          <button
            type="button"
            onClick={() => navigate('/dashboard', { replace: true })}
            className="btn-glow inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-medium text-white"
          >
            <House className="h-4 w-4" strokeWidth={1.5} />
            回到工作台
          </button>
        </div>
      </div>
    </div>
  );
}
