import { Input, Select, Button, Space } from 'antd';
import { SearchOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

interface FilterOption {
  label: string;
  value: string | number;
}

interface FilterField {
  key: string;
  placeholder?: string;
  width?: number;
  options?: FilterOption[];
  type: 'input' | 'select';
}

interface SearchFilterBarProps {
  filters: FilterField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onSearch: () => void;
  onReset: () => void;
  addText?: string;
  onAdd?: () => void;
  extra?: ReactNode;
  loading?: boolean;
}

export function SearchFilterBar({
  filters,
  values,
  onChange,
  onSearch,
  onReset,
  addText = '新增',
  onAdd,
  extra,
  loading,
}: SearchFilterBarProps) {
  return (
    <Space wrap className="w-full justify-between">
      <Space wrap size="middle">
        {filters.map((field) =>
          field.type === 'input' ? (
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
          ) : (
            <Select
              key={field.key}
              placeholder={field.placeholder}
              value={values[field.key] as string | number | undefined}
              onChange={(value) => onChange(field.key, value)}
              options={field.options}
              style={{ width: field.width || 144 }}
              allowClear
            />
          )
        )}
        <Button type="primary" icon={<SearchOutlined />} onClick={onSearch} loading={loading}>
          查询
        </Button>
        <Button icon={<ReloadOutlined />} onClick={onReset}>
          重置
        </Button>
      </Space>

      <Space>
        {extra}
        {onAdd && (
          <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
            {addText}
          </Button>
        )}
      </Space>
    </Space>
  );
}
