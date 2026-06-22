import { Modal } from 'antd';
import type { ReactNode } from 'react';
import { tokens } from '@/styles/theme';

interface TsModalProps {
  title: string;
  open: boolean;
  onCancel: () => void;
  onOk?: () => void;
  children: ReactNode;
  confirmLoading?: boolean;
  width?: number;
  footer?: ReactNode | null;
}

export function TsModal({
  title,
  open,
  onCancel,
  onOk,
  children,
  confirmLoading,
  width = 560,
  footer,
}: TsModalProps) {
  return (
    <Modal
      title={<span className="text-lg font-semibold text-slate-900">{title}</span>}
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      confirmLoading={confirmLoading}
      width={width}
      footer={footer}
      styles={{
        body: {
          padding: 24,
          maxHeight: '70vh',
          overflow: 'auto',
        },
        header: {
          padding: '16px 24px',
          borderBottom: `1px solid ${tokens.colors.border}`,
          marginBottom: 0,
        },
        footer: {
          padding: '12px 24px',
          borderTop: `1px solid ${tokens.colors.border}`,
          marginTop: 0,
        },
      }}
    >
      {children}
    </Modal>
  );
}
