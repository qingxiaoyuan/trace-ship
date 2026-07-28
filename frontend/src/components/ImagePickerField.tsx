import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Box, Check, Container, HardDrive, Search } from 'lucide-react';
import { Modal } from 'antd';
import { packageApi } from '@/api/package';
import type { AvailableImageItem, PackageImageSource } from '@/types';

interface ImagePickerFieldProps {
  value?: string;
  onChange?: (value: string | undefined) => void;
  placeholder?: string;
}

/** 打包镜像选择字段：只读展示当前镜像，点击按钮打开弹窗选择 */
export function ImagePickerField({ value, onChange, placeholder }: ImagePickerFieldProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <div
          className={`flex-1 truncate rounded-lg border px-3 py-1.5 font-mono text-[12px] ${
            value ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-dashed border-slate-200 text-slate-400'
          }`}
        >
          {value || placeholder || '未选择镜像'}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/50 px-2.5 py-1.5 text-[12px] font-medium text-indigo-600 transition-colors hover:bg-indigo-100"
        >
          <Container className="h-3 w-3" strokeWidth={1.5} />
          选择镜像
        </button>
      </div>
      <ImagePickerModal
        open={open}
        value={value || ''}
        onCancel={() => setOpen(false)}
        onSelect={(image) => {
          onChange?.(image);
          setOpen(false);
        }}
      />
    </>
  );
}

interface ImagePickerModalProps {
  open: boolean;
  value: string;
  onCancel: () => void;
  onSelect: (image: string) => void;
}

const sourceTabs: { label: string; value: PackageImageSource }[] = [
  { label: '本地', value: 'local' },
  { label: 'Nexus', value: 'nexus' },
];

/** 镜像选择弹窗：高密度列表，tag 区分本地 / Nexus，默认本地 */
function ImagePickerModal({ open, value, onCancel, onSelect }: ImagePickerModalProps) {
  // Modal destroyOnClose：每次打开都重新挂载，以最新 value 初始化
  const [source, setSource] = useState<PackageImageSource>('local');
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(value);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['available-images', 'picker', source, search],
    queryFn: () => packageApi.getAvailableImages({ source, keyword: search || undefined }),
    enabled: open,
  });

  const items = data?.items || [];
  const loadError = data?.errors?.[source];

  return (
    <Modal
      open={open}
      title="选择打包镜像"
      width={680}
      onCancel={onCancel}
      onOk={() => onSelect(selected)}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: !selected }}
      destroyOnClose
      zIndex={1100}
    >
      <div className="space-y-2.5 py-1">
        <div className="flex items-center gap-2">
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
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={1.5} />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setSearch(keyword.trim())}
              placeholder="搜索镜像名，回车确认"
              className="w-full rounded-lg border border-indigo-100 bg-white py-1.5 pl-8 pr-3 text-[12px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <span className="shrink-0 text-[11px] text-slate-400">
            {isFetching ? '加载中…' : `共 ${items.length} 个`}
          </span>
        </div>

        {loadError && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            {loadError}
          </div>
        )}

        <div className="max-h-[340px] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-150 border-slate-100">
          {isLoading ? (
            <div className="px-4 py-10 text-center text-[12px] text-slate-400">加载中…</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Box className="mx-auto h-8 w-8 text-slate-300" strokeWidth={1.5} />
              <p className="mt-2 text-[12px] text-slate-400">暂无可用镜像</p>
            </div>
          ) : (
            items.map((item) => (
              <PickerRow
                key={`${item.source}:${item.image}`}
                item={item}
                active={selected === item.image}
                onSelect={() => setSelected(item.image)}
                onConfirm={() => onSelect(item.image)}
              />
            ))
          )}
        </div>

        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5">
          <span className="text-[11px] text-slate-400">当前选择：</span>
          <span className="font-mono text-[11px] text-slate-600">{selected || '未选择'}</span>
        </div>
      </div>
    </Modal>
  );
}

interface PickerRowProps {
  item: AvailableImageItem;
  active: boolean;
  onSelect: () => void;
  onConfirm: () => void;
}

function PickerRow({ item, active, onSelect, onConfirm }: PickerRowProps) {
  const isLocal = item.source === 'local';
  return (
    <div
      onClick={onSelect}
      onDoubleClick={onConfirm}
      className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors ${
        active ? 'bg-indigo-50/60' : 'hover:bg-indigo-50/30'
      }`}
    >
      <span
        className={`inline-flex shrink-0 items-center rounded border px-1 py-px text-[10px] font-medium ${
          isLocal
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-indigo-200 bg-indigo-50 text-indigo-600'
        }`}
      >
        {isLocal ? '本地' : 'Nexus'}
      </span>
      {isLocal ? (
        <HardDrive className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={1.5} />
      ) : (
        <Container className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={1.5} />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[12px] text-slate-800">{item.image}</div>
        <div className="truncate text-[10px] text-slate-400">
          {isLocal
            ? [item.size, item.image_id].filter(Boolean).join(' · ') || '本地镜像'
            : item.repository || 'Nexus 仓库'}
        </div>
      </div>
      {active && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-500" strokeWidth={2} />}
    </div>
  );
}
