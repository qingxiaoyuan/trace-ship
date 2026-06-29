import { tokens } from '@/styles/theme';
import { tabItems, type TabKey } from '../constants';

// 工作流页面顶部的 Tab 切换头
export function TabHeader({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (key: TabKey) => void;
}) {
  return (
    <div
      className="flex px-5 border-b"
      style={{ borderColor: tokens.colors.border }}
    >
      {tabItems.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className="relative px-4 py-3 text-sm font-medium transition-colors"
            style={{
              color: isActive
                ? tokens.colors.textPrimary
                : tokens.colors.textSecondary,
            }}
          >
            {tab.label}
            {isActive && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ background: tokens.colors.textPrimary }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
