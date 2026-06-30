import { Modal } from 'antd';
import type { ReactNode, CSSProperties } from 'react';

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
  bodyStyle?: CSSProperties;
  bodyClassName?: string;
  footerStyle?: CSSProperties;
  destroyOnClose?: boolean;
  afterOpenChange?: (open: boolean) => void;
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
  bodyStyle,
  bodyClassName,
  footerStyle,
  destroyOnClose,
  afterOpenChange,
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
      centered
      footer={footer}
      destroyOnClose={destroyOnClose}
      afterOpenChange={afterOpenChange}
      classNames={{
        header: 'px-6 py-4 border-b border-indigo-50 mb-0',
        body: `px-6 py-5 scrollbar-thin ${bodyClassName || ''}`,
        footer: 'px-6 py-4 border-t border-indigo-50 mt-0',
      }}
      styles={{
        container: {
          background: '#ffffff',
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
          ...bodyStyle,
        },
        footer: {
          padding: '16px 24px',
          borderTop: '1px solid #EEF2FF',
          marginTop: 0,
          background: 'rgba(255, 255, 255, 0.5)',
          ...footerStyle,
        },
        mask: {
          backgroundColor: 'rgba(15, 23, 42, 0.45)',
        },
      }}
    >
      {children}
    </Modal>
  );
}
