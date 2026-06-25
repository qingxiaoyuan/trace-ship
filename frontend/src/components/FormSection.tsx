interface FormSectionProps {
  title: string;
  children: React.ReactNode;
}

export function FormSection({ title, children }: FormSectionProps) {
  return (
    <div className="bg-[#FAFAF9] rounded-xl border border-[#EFEFEC] p-5 mb-4 last:mb-0">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-1 h-4 rounded-full bg-[#2563EB]" />
        <span className="text-sm font-semibold text-[#1F2937]">{title}</span>
      </div>
      {children}
    </div>
  );
}
