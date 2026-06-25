import { Input, Select, Button, DatePicker, Tooltip } from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  FilterOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import type { Dayjs } from 'dayjs';

interface FilterOption {
  label: string;
  value: string | number;
}

interface FilterField {
  key: string;
  placeholder?: string;
  width?: number;
  options?: FilterOption[];
  type: 'input' | 'select' | 'date';
}

interface SearchFilterBarProps {
  filters: FilterField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onSearch: () => void;
  onReset: () => void;
  extra?: ReactNode;
  loading?: boolean;
}

export function SearchFilterBar({
  filters,
  values,
  onChange,
  onSearch,
  onReset,
  extra,
  loading,
}: SearchFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {filters.map((field) => {
          if (field.type === 'input') {
            return (
              <Input
                key={field.key}
                placeholder={field.placeholder}
                value={(values[field.key] as string) || ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                onPressEnter={onSearch}
                style={{ width: field.width || 256 }}
                prefix={<SearchOutlined className="text-slate-400" />}
                allowClear
              />
            );
          }
          if (field.type === 'date') {
            return (
              <DatePicker
                key={field.key}
                placeholder={field.placeholder}
                value={(values[field.key] as Dayjs) || null}
                onChange={(value) => onChange(field.key, value)}
                style={{ width: field.width || 160 }}
                prefix={<CalendarOutlined className="text-slate-400" />}
                allowClear
              />
            );
          }
          return (
            <Select
              key={field.key}
              placeholder={field.placeholder}
              value={values[field.key] as string | number | undefined}
              onChange={(value) => onChange(field.key, value)}
              options={field.options}
              style={{ width: field.width || 144 }}
              prefix={<FilterOutlined className="text-slate-400" />}
              allowClear
            />
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Button type="primary" icon={<SearchOutlined />} onClick={onSearch} loading={loading}>
          查询
        </Button>
        <Tooltip title="重置">
          <Button icon={<ReloadOutlined />} onClick={onReset} />
        </Tooltip>
      </div>

      {extra && <div className="ml-auto">{extra}</div>}
    </div>
  );
}
