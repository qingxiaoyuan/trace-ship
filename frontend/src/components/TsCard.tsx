import { Card } from 'antd';
import type { ReactNode } from 'react';
import { tokens } from '@/styles/theme';

interface TsCardProps {
  children: ReactNode;
  title?: ReactNode;
  extra?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
}

export function TsCard({ children, title, extra, className, style, bodyStyle }: TsCardProps) {
  return (
    <Card
      title={title}
      extra={extra}
      className={className}
      style={{
        borderRadius: tokens.layout.cardRadius,
        border: `1px solid ${tokens.colors.border}`,
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.03)',
        ...style,
      }}
      bodyStyle={{ padding: 20, ...bodyStyle }}
      headStyle={{
        borderBottom: `1px solid ${tokens.colors.border}`,
        padding: '16px 20px',
        fontWeight: 700,
      }}
    >
      {children}
    </Card>
  );
}
