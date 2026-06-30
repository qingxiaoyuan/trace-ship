interface FormSectionProps {
  title: string;
  children: React.ReactNode;
  /** 无背景卡片样式 */
  plain?: boolean;
  /** 标题右侧额外内容 */
  extra?: React.ReactNode;
  /** 紧凑模式：更小的内边距与标题间距 */
  compact?: boolean;
}

export function FormSection({ title, children, plain, extra, compact }: FormSectionProps) {
  const paddingClass = plain ? "" : compact ? "p-4" : "p-5";
  const marginClass = compact ? "mb-3" : "mb-4";
  const titleMarginClass = compact ? "mb-3" : "mb-5";

  return (
    <div
      className={`
        ${plain ? "" : "bg-[#FAFAF9] rounded-xl border border-[#EFEFEC]"}
        ${paddingClass}
        ${marginClass}
        last:mb-0
      `}
    >
      <div className={`flex items-center gap-2 ${titleMarginClass}`}>
        <div className="w-1 h-4 rounded-full bg-[#2563EB]" />
        <span className="text-sm font-semibold text-[#1F2937]">{title}</span>
        {extra}
      </div>
      {children}
    </div>
  );
}
