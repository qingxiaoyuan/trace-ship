import { Download, Globe, TriangleAlert } from 'lucide-react';
import { AI_AGENT_URL, CHROME_DOWNLOAD_URL } from '@/utils/browserCheck';

export default function BrowserUpgrade() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F6F7FB] px-4">
      <div className="tech-card w-full max-w-[480px] rounded-2xl p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl icon-amber">
          <TriangleAlert className="h-7 w-7" strokeWidth={1.5} />
        </div>

        <h1 className="mt-5 text-[20px] font-semibold tracking-tight text-slate-900">
          浏览器版本过低
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-slate-500">
          当前浏览器不支持 AI 生成镜像所需的高版本 API，
          <br />
          请下载安装最新版谷歌浏览器后重新访问。
        </p>

        <a
          href={CHROME_DOWNLOAD_URL}
          className="btn-glow mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[14px] font-medium text-white"
        >
          <Download className="h-4 w-4" strokeWidth={1.5} />
          下载最新版 Chrome（离线安装包）
        </a>

        <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <Globe className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>Windows 64 位 · ChromeStandaloneSetup64.exe</span>
        </div>

        <div className="mt-6 border-t border-indigo-50 pt-4">
          <a
            href={AI_AGENT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-indigo-500 transition-colors hover:text-indigo-600 hover:underline"
          >
            确认浏览器已是最新？直接尝试访问 AI 生成镜像
          </a>
        </div>
      </div>
    </div>
  );
}
