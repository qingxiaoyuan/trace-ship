import type { ReactNode } from 'react';
import { tokens } from '@/styles/theme';

interface TsListProps<T> {
  dataSource: T[];
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  split?: boolean;
}

export function TsList<T>({
  dataSource,
  renderItem,
  className,
  split = true,
}: TsListProps<T>) {
  return (
    <div className={className}>
      {dataSource.map((item, index) => (
        <div
          key={index}
          className={split && index !== dataSource.length - 1 ? 'border-b' : ''}
          style={{
            borderColor: split && index !== dataSource.length - 1 ? tokens.colors.border : undefined,
          }}
        >
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  );
}
