import { Tag } from 'antd';

export type StatusType = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'indigo';

interface StatusTagProps {
  status: StatusType;
  children: React.ReactNode;
  className?: string;
}

const colorMap: Record<StatusType, { bg: string; text: string }> = {
  primary: { bg: '#F1F5F9', text: '#111111' },
  success: { bg: '#EDF3EC', text: '#346538' },
  warning: { bg: '#FBF3DB', text: '#956400' },
  danger: { bg: '#FDEBEC', text: '#9F2F2D' },
  info: { bg: '#E1F3FE', text: '#1F6C9F' },
  neutral: { bg: '#F1F5F9', text: '#787774' },
  indigo: { bg: '#EEF2FF', text: '#4F46E5' },
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
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        display: 'inline-flex',
        alignItems: 'center',
        lineHeight: 1.25,
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
