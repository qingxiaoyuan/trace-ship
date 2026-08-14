import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Modal } from 'antd';
import { AlertTriangle, Box, Container, HardDrive, RefreshCw, Search, Sparkles, Upload } from 'lucide-react';
import { packageApi } from '@/api/package';
import { openAiAgent } from '@/utils/browserCheck';
import type { AvailableImageItem, PackageImageSource } from '@/types';

type SourceFilter = '' | PackageImageSource;

const sourceTabs: { label: string; value: SourceFilter }[] = [
  { label: '全部', value: '' },
  { label: '本地', value: 'local' },
  { label: 'Nexus', value: 'nexus' },
];

const sourceBadgeMap: Record<PackageImageSource, string> = {
  local: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  nexus: 'border-indigo-200 bg-indigo-50 text-indigo-600',
};

const sourceLabelMap: Record<PackageImageSource, string> = {
  local: '本地',
  nexus: 'Nexus',
};

export default function PackageImagePage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [source, setSource] = useState<SourceFilter>('');
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<string[] | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['available-images', source, search],
    queryFn: () => packageApi.getAvailableImages({ source: source || undefined, keyword: search || undefined }),
  });

  const items = data?.items || [];
  const errors = data?.errors || {};

  const importMutation = useMutation({
    mutationFn: (file: File) => packageApi.importImage(file),
    onSuccess: (result) => {
      setImportResult(result.loaded);
      if (result.loaded.length > 0) {
        message.success(`已导入 ${result.loaded.length} 个镜像`);
      } else {
        message.warning('导入完成，但镜像包中未包含命名镜像');
      }
      queryClient.invalidateQueries({ queryKey: ['available-images'] });
    },
  });

  const closeImport = () => {
    setImportOpen(false);
    setImportFile(null);
    setImportResult(null);
  };

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">打包镜像</h1>
          <p className="mt-1 text-[13px] text-slate-500">实时列出本机 Docker 与已配置 Nexus 仓库中可用于打包的镜像</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openAiAgent}
            title="在新标签页打开 AI 生成镜像"
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
            AI 生成镜像
          </button>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
            导入镜像
          </button>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} strokeWidth={1.5} />
            刷新
          </button>
        </div>
      </div>

      {(errors.local || errors.nexus) && (
        <div className="space-y-1.5">
          {errors.local && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              本地 Docker：{errors.local}
            </div>
          )}
          {errors.nexus && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              Nexus：{errors.nexus}
            </div>
          )}
        </div>
      )}

      <div className="tech-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="flex rounded-lg border border-indigo-100 bg-slate-50 p-0.5">
            {sourceTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setSource(tab.value)}
                className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
                  source === tab.value ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setSearch(keyword.trim())}
              placeholder="搜索镜像名，回车确认"
              className="w-[220px] rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="ml-auto text-[12px] text-slate-400">共 {items.length} 个镜像</div>
        </div>

        <div className="hidden grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <div className="col-span-5">镜像地址</div>
          <div className="col-span-2">镜像名 / 标签</div>
          <div className="col-span-2">仓库</div>
          <div className="col-span-1">大小</div>
          <div className="col-span-1">镜像 ID</div>
          <div className="col-span-1 text-center">来源</div>
        </div>

        <div className="max-h-[calc(100vh-300px)] divide-y divide-indigo-50/50 overflow-y-auto">
          {isLoading ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
          ) : items.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Box className="mx-auto h-10 w-10 text-slate-300" strokeWidth={1.5} />
              <p className="mt-3 text-[13px] text-slate-400">暂无可用镜像</p>
            </div>
          ) : (
            items.map((item) => <ImageRow key={`${item.source}:${item.image}`} item={item} />)
          )}
        </div>
      </div>

      <details className="tech-card rounded-xl px-5 py-4 text-[12px] text-slate-500">
        <summary className="cursor-pointer text-[13px] font-medium text-slate-700">镜像接入规范</summary>
        <div className="mt-3 space-y-2">
          <p className="font-medium">目录约定</p>
          <pre className="rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-600">
{`/workspace/
  source/        # 平台挂载：源码目录（工作目录）
  artifacts/     # 平台挂载：产物输出目录
  tmp/           # 平台挂载：临时目录
  scripts/       # 镜像提供：预制脚本，必须包含 pack.sh 入口
  deploy/        # 镜像提供：预制依赖（可选）`}
          </pre>
          <p className="font-medium">镜像必须满足</p>
          <ul className="list-disc pl-4 text-[11px]">
            <li>/workspace/scripts/pack.sh：内置打包入口脚本</li>
            <li>容器内存在 /bin/sh（平台统一以 --entrypoint /bin/sh 启动，镜像 ENTRYPOINT 不生效）</li>
          </ul>
          <p className="font-medium">执行逻辑</p>
          <ol className="list-decimal pl-4 text-[11px]">
            <li>未填写自定义脚本：执行镜像的 /workspace/scripts/pack.sh</li>
            <li>填写了自定义脚本：在 /workspace/source（或 BUILD_PATH 指定目录）以 sh -ec 执行（遇错即停），不经过 pack.sh</li>
            <li>环境变量：WORKSPACE、SOURCE_DIR、ARTIFACTS_DIR、DEPLOY_DIR、SCRIPTS_DIR、BUILD_PATH、OUTPUT_PATH、TAG_NAME、VERSION、PROJECT_CODE</li>
            <li>产物统一写入 /workspace/artifacts，不主动从互联网拉取依赖</li>
          </ol>
        </div>
      </details>

      <Modal
        open={importOpen}
        title="导入本地镜像"
        width={520}
        onCancel={closeImport}
        okText="开始导入"
        cancelText="关闭"
        confirmLoading={importMutation.isPending}
        okButtonProps={{ disabled: !importFile || importMutation.isPending }}
        onOk={() => importFile && importMutation.mutate(importFile)}
        destroyOnHidden
      >
        <div className="space-y-3 py-1">
          <p className="text-[12px] text-slate-400">
            上传 docker save 导出的镜像包（.tar / .tar.gz / .tar.bz2 / .tar.xz），导入到本机 Docker
          </p>
          <label
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 transition-colors ${
              importFile ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/20'
            }`}
          >
            <Upload className="h-6 w-6 text-slate-400" strokeWidth={1.5} />
            <span className="text-[13px] text-slate-600">
              {importFile ? importFile.name : '点击选择镜像包文件'}
            </span>
            {importFile && (
              <span className="text-[11px] text-slate-400">{(importFile.size / 1024 / 1024).toFixed(1)} MB</span>
            )}
            <input
              type="file"
              accept=".tar,.tar.gz,.tgz,.tar.bz2,.tar.xz"
              className="hidden"
              onChange={(e) => {
                setImportFile(e.target.files?.[0] || null);
                setImportResult(null);
              }}
            />
          </label>
          {importResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <div className="text-[12px] font-medium text-emerald-700">导入成功：</div>
              <div className="mt-1 space-y-0.5">
                {importResult.map((image) => (
                  <div key={image} className="font-mono text-[12px] text-emerald-800">{image}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

function ImageRow({ item }: { item: AvailableImageItem }) {
  return (
    <div className="grid grid-cols-12 items-center gap-3 px-5 py-3 transition-colors hover:bg-indigo-50/30">
      <div className="col-span-12 flex items-center gap-2 md:col-span-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg icon-indigo">
          {item.source === 'local' ? (
            <HardDrive className="h-4 w-4" strokeWidth={1.5} />
          ) : (
            <Container className="h-4 w-4" strokeWidth={1.5} />
          )}
        </div>
        <span className="truncate font-mono text-[12px] text-slate-700">{item.image}</span>
      </div>
      <div className="col-span-6 truncate text-[12px] text-slate-600 md:col-span-2">
        {item.name}
        <span className="ml-1.5 rounded border border-slate-200 bg-slate-50 px-1 py-px font-mono text-[10px] text-slate-500">
          {item.version}
        </span>
      </div>
      <div className="col-span-6 truncate text-[12px] text-slate-500 md:col-span-2">{item.repository || '-'}</div>
      <div className="col-span-4 text-[12px] text-slate-500 md:col-span-1">{item.size || '-'}</div>
      <div className="col-span-4 font-mono text-[11px] text-slate-400 md:col-span-1">{item.image_id || '-'}</div>
      <div className="col-span-4 flex items-center justify-center md:col-span-1">
        <span
          className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${sourceBadgeMap[item.source]}`}
        >
          {sourceLabelMap[item.source]}
        </span>
      </div>
    </div>
  );
}
