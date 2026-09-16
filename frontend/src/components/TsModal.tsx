import { Modal } from 'antd';
import type { ReactNode, CSSProperties } from 'react';

interface TsModalProps {
  title: ReactNode;
  subtitle?: string;
  titleIcon?: ReactNode;
  open: boolean;
  onCancel: () => void;
  onOk?: () => void;
  children: ReactNode;
  confirmLoading?: boolean;
  okText?: string;
  cancelText?: string;
  okButtonProps?: { loading?: boolean; disabled?: boolean; danger?: boolean };
  cancelButtonProps?: { disabled?: boolean };
  width?: number;
  footer?: ReactNode | null;
  bodyStyle?: CSSProperties;
  bodyClassName?: string;
  footerStyle?: CSSProperties;
  destroyOnHidden?: boolean;
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
  okText,
  cancelText,
  okButtonProps,
  cancelButtonProps,
  width = 560,
  footer,
  bodyStyle,
  bodyClassName,
  footerStyle,
  destroyOnHidden,
  afterOpenChange,
}: TsModalProps) {
  const titleNode = (
    <div className="flex items-start gap-3">
      {titleIcon && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EEF2FF] text-[#4F46E5] ring-1 ring-[#E0E7FF]">
          {titleIcon}
        </div>
      )}
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-tight text-[#0F172A] leading-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="text-[13px] text-[#64748B] leading-snug mt-0.5">{subtitle}</p>
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
      okText={okText}
      cancelText={cancelText}
      okButtonProps={okButtonProps}
      cancelButtonProps={cancelButtonProps}
      width={width}
      centered
      footer={footer}
      destroyOnHidden={destroyOnHidden}
      afterOpenChange={afterOpenChange}
      classNames={{
        body: `scrollbar-thin ${bodyClassName || ''}`,
      }}
      styles={{
        container: {
          // antd v6 默认在 container 上有 contentPadding，会与本组件 header/body/footer
          // 内边距叠加成双倍，这里清零，由内边距语义分区单独控制
          padding: 0,
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #E0E7FF',
          boxShadow: '0 24px 64px -16px rgba(15, 23, 42, 0.35)',
          overflow: 'hidden',
        },
        header: {
          padding: '20px 24px 16px',
          borderBottom: '1px solid #EDEFF7',
          marginBottom: 0,
        },
        body: {
          padding: '20px 24px',
          maxHeight: '70vh',
          overflow: 'auto',
          ...bodyStyle,
        },
        footer: {
          padding: '14px 24px',
          borderTop: '1px solid #EDEFF7',
          marginTop: 0,
          background: '#F9FAFD',
          ...footerStyle,
        },
        mask: {
          backgroundColor: 'rgba(11, 16, 32, 0.45)',
        },
      }}
    >
      {children}
    </Modal>
  );
}
