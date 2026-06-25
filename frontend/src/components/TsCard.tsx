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
  headStyle?: React.CSSProperties;
}

export function TsCard({
  children,
  title,
  extra,
  className,
  style,
  bodyStyle,
  headStyle,
}: TsCardProps) {
  return (
    <Card
      title={title}
      extra={extra}
      className={className}
      style={{
        borderRadius: tokens.layout.cardRadius,
        border: `1px solid ${tokens.colors.border}`,
        boxShadow: 'none',
        marginBottom: 16,
        ...style,
      }}
      styles={{
        body: { padding: 20, ...bodyStyle },
        header: {
          borderBottom: `1px solid ${tokens.colors.border}`,
          padding: '16px 20px',
          fontWeight: 700,
          ...headStyle,
        },
      }}
    >
      {children}
    </Card>
  );
}
