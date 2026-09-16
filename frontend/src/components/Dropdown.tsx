import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface DropdownOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  popClassName?: string;
  width?: number;
  /** 打开后显示搜索框，按 label 过滤选项 */
  searchable?: boolean;
  searchPlaceholder?: string;
}

/** 轻量自定义下拉，浮层通过 Portal 渲染到 body，避免被父容器 overflow 裁切 */
export function Dropdown({
  value,
  options,
  onChange,
  placeholder = '请选择',
  className = '',
  popClassName = '',
  width,
  searchable = false,
  searchPlaceholder = '搜索',
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  // 计算浮层位置：贴合触发器底部
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setCoords({
      top: rect.bottom + window.scrollY + 6,
      left: rect.left + window.scrollX,
      width: rect.width,
    });
  }, [open]);

  // 点击外部收起 + 滚动时跟随
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + window.scrollY + 6,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    };
    const handler = (e: MouseEvent) => {
      if (
        wrapRef.current && wrapRef.current.contains(e.target as Node)
      ) return;
      if (popRef.current && popRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setKeyword('');
      return;
    }
    if (searchable) {
      const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [open, searchable]);

  const selected = options.find((o) => o.value === value);
  const visibleOptions = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!searchable || !q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [keyword, options, searchable]);

  return (
    <div ref={wrapRef} className={`relative ${className}`} style={width ? { width } : undefined}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] text-slate-700 outline-none transition-colors hover:border-indigo-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      >
        <span className={`flex items-center gap-2 truncate ${selected ? 'text-slate-700' : 'text-slate-400'}`}>
          {selected?.icon}
          {selected?.label || placeholder}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          style={{ strokeWidth: 1.5 }}
        />
      </button>
      {open && coords && createPortal(
        <div
          ref={popRef}
          className={`fixed z-[9999] overflow-hidden rounded-[10px] border border-indigo-100 bg-white p-1.5 shadow-[0_12px_32px_-8px_rgba(79,70,229,.22)] ${popClassName}`}
          style={{
            top: coords.top - window.scrollY,
            left: coords.left - window.scrollX,
            width: coords.width,
          }}
        >
          {searchable && (
            <div className="mb-1 flex items-center gap-1.5 rounded-md border border-indigo-100 bg-slate-50 px-2 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" style={{ strokeWidth: 1.5 }} />
              <input
                ref={searchRef}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>
          )}
          <div className="max-h-[200px] overflow-y-auto scrollbar-thin">
          {visibleOptions.length === 0 ? (
            <div className="px-2.5 py-2 text-center text-[12px] text-slate-400">{options.length === 0 ? '无选项' : '无匹配结果'}</div>
          ) : (
            visibleOptions.map((o) => {
              const active = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                    active ? 'bg-indigo-50 font-medium text-indigo-600' : 'text-slate-600 hover:bg-indigo-50/60'
                  }`}
                >
                  {o.icon}
                  <span className="flex-1 truncate">{o.label}</span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-500" style={{ strokeWidth: 1.5 }} />}
                </button>
              );
            })
          )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
