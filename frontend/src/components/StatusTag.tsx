import { Tag } from 'antd';

type StatusType = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface StatusTagProps {
  status: StatusType;
  children: React.ReactNode;
  className?: string;
}

const colorMap: Record<StatusType, { bg: string; text: string }> = {
  primary: { bg: '#EFF6FF', text: '#2563EB' },
  success: { bg: '#ECFDF5', text: '#059669' },
  warning: { bg: '#FFFBEB', text: '#B45309' },
  danger: { bg: '#FEF2F2', text: '#DC2626' },
  info: { bg: '#EFF6FF', text: '#1D4ED8' },
  neutral: { bg: '#F1F5F9', text: '#64748B' },
};

export function StatusTag({ status, children, className }: StatusTagProps) {
  const colors = colorMap[status];
  return (
    <Tag
      className={className}
      style={{
        background: colors.bg,
        color: colors.text,
        border: 'none',
        borderRadius: 9999,
        padding: '4px 10px',
        fontWeight: 600,
        fontSize: 12,
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      <span
        className="inline-block w-[6px] h-[6px] rounded-full mr-[6px]"
        style={{ background: colors.text }}
      />
      {children}
    </Tag>
  );
}
