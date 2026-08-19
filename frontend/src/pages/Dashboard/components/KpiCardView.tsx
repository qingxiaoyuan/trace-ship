import type { KpiCard } from '../types';
import { IconBox } from './SmallTag';

/** KPI 指标卡片视图；compact 用于移动端双列布局（更紧凑、不显示底部扩展区） */
export function KpiCardView({ card, compact = false }: { card: KpiCard; compact?: boolean }) {
  return (
    <div className={`tech-card tech-card-hover rounded-xl ${compact ? 'p-3.5' : 'p-5'}`}>
      <div className="flex items-start justify-between">
        <IconBox icon={card.icon} className={card.iconClass} />
        {card.action}
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
