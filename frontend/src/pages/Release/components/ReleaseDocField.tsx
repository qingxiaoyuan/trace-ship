import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  CHECKBOX_FIELDS,
  getSelectedOptions,
  toggleOption,
} from './releaseDocUtils';

export type { MdTableRow } from './releaseDocUtils';

/** 复选框字段渲染（编辑/查看共用） */
export function CheckboxField({
  value,
  fieldKey,
  disabled = false,
  onChange,
}: {
  value: string;
  fieldKey: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
}) {
  const config = CHECKBOX_FIELDS[fieldKey];
  const selected = getSelectedOptions(value, config);

  return (
    <div className="flex flex-wrap items-center gap-4">
      {config.options.map((option) => {
        const checked = selected.includes(option);
        return (
          <label
            key={option}
            className={`inline-flex items-center gap-1.5 text-[13px] ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => {
                if (!disabled && onChange) {
                  onChange(toggleOption(value, option, config));
                }
              }}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className={checked ? 'text-slate-900' : 'text-slate-500'}>{option}</span>
          </label>
        );
      })}
    </div>
  );
}

/** 自动撑开高度的 textarea */
export function AutoResizeTextarea({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    resize();
  }, [value]);

  useEffect(() => {
    const timer = window.setTimeout(resize, 50);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      className={className}
    />
  );
}
