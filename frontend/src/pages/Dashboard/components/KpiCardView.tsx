import { ArrowUpRight } from 'lucide-react';
import type { KpiCard } from '../types';
import { IconBox } from './SmallTag';

/** KPI 指标卡片视图；整卡可点击跳转，compact 用于移动端双列布局（更紧凑、不显示底部扩展区） */
export function KpiCardView({ card, compact = false }: { card: KpiCard; compact?: boolean }) {
  const clickable = Boolean(card.onClick);
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={card.onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === ' ') e.preventDefault();
              if (e.key === 'Enter' || e.key === ' ') card.onClick?.();
            }
          : undefined
      }
      className={`tech-card tech-card-hover group relative rounded-xl ${compact ? 'p-3.5' : 'p-5'} ${
        clickable ? 'cursor-pointer' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <IconBox icon={card.icon} className={card.iconClass} />
        {card.action ??
          (clickable ? (
            <ArrowUpRight
              className="h-4 w-4 text-slate-300 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-indigo-500"
              strokeWidth={1.5}
            />
          ) : null)}
      </div>
      <div className={compact ? 'mt-2' : 'mt-4'}>
        <div className="flex items-baseline gap-1.5">
          {card.value}
          {card.unit ? <span className="text-[13px] text-slate-400">{card.unit}</span> : null}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[12px] text-slate-500">{card.description}</div>
      </div>
      {!compact && card.footer ? <div className="mt-3">{card.footer}</div> : null}
    </div>
  );
}
