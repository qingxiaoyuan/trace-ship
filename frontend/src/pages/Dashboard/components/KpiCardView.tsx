import type { KpiCard } from '../types';
import { IconBox } from './SmallTag';

/** KPI 指标卡片视图 */
export function KpiCardView({ card }: { card: KpiCard }) {
  return (
    <div className="tech-card tech-card-hover rounded-xl p-5">
      <div className="flex items-start justify-between">
        <IconBox icon={card.icon} className={card.iconClass} />
        {card.action}
      </div>
      <div className="mt-4">
        <div className="flex items-baseline gap-1.5">
          {card.value}
          {card.unit ? <span className="text-[13px] text-slate-400">{card.unit}</span> : null}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[12px] text-slate-500">{card.description}</div>
      </div>
      {card.footer ? <div className="mt-3">{card.footer}</div> : null}
    </div>
  );
}
