import { Modal } from 'antd';
import type { ReactNode } from 'react';

interface TsModalProps {
  title: string;
  subtitle?: string;
  titleIcon?: ReactNode;
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
  subtitle,
  titleIcon,
  open,
  onCancel,
  onOk,
  children,
  confirmLoading,
  width = 560,
  footer,
}: TsModalProps) {
  const titleNode = (
    <div className="flex items-center gap-3">
      {titleIcon && (
        <div className="flex h-9 w-9 items-center justify-center rounded-lg icon-indigo">
          {titleIcon}
        </div>
      )}
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight text-slate-900 leading-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="text-[11px] text-slate-400 leading-tight mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      title={titleNode}
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      confirmLoading={confirmLoading}
      width={width}
      footer={footer}
      classNames={{
        header: 'px-6 py-4 border-b border-indigo-50 mb-0',
        body: 'px-6 py-5 scrollbar-thin',
        footer: 'px-6 py-4 border-t border-indigo-50 mt-0',
      }}
      styles={{
        container: {
          background: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(12px) saturate(160%)',
          WebkitBackdropFilter: 'blur(12px) saturate(160%)',
          borderRadius: '16px',
          border: '1px solid rgba(99, 102, 241, 0.12)',
          boxShadow: '0 24px 70px -12px rgba(30, 27, 75, 0.55)',
          overflow: 'hidden',
        },
        header: {
          padding: '16px 24px',
          borderBottom: '1px solid #EEF2FF',
          marginBottom: 0,
        },
        body: {
          padding: '20px 24px',
          maxHeight: '70vh',
          overflow: 'auto',
        },
        footer: {
          padding: '16px 24px',
          borderTop: '1px solid #EEF2FF',
          marginTop: 0,
          background: 'rgba(255, 255, 255, 0.5)',
        },
        mask: {
          backdropFilter: 'blur(2px)',
        },
      }}
    >
      {children}
    </Modal>
  );
}
