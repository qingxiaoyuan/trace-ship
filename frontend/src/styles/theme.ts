export const tokens = {
  colors: {
    primary: '#2563EB',
    primaryLight: '#3B82F6',
    primaryDark: '#1D4ED8',
    success: '#10B981',
    successDark: '#059669',
    warning: '#F59E0B',
    warningDark: '#D97706',
    danger: '#EF4444',
    dangerDark: '#DC2626',
    info: '#3B82F6',
    ai: '#8B5CF6',
    bg: '#F8FAFC',
    surface: '#FFFFFF',
    border: '#E2E8F0',
    textPrimary: '#0F172A',
    textBody: '#334155',
    textSecondary: '#64748B',
    textMuted: '#94A3B8',
    logBg: '#0F172A',
    logText: '#34D399',
  },
  layout: {
    sidebarWidth: 240,
    headerHeight: 64,
    pagePadding: 24,
    cardRadius: 16,
    buttonRadius: 12,
    inputRadius: 12,
  },
};

export const antdTheme = {
  token: {
    colorPrimary: tokens.colors.primary,
    colorSuccess: tokens.colors.success,
    colorWarning: tokens.colors.warning,
    colorError: tokens.colors.danger,
    colorInfo: tokens.colors.info,
    borderRadius: 12,
    borderRadiusSM: 8,
    borderRadiusLG: 16,
    fontFamily:
      '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  },
  components: {
    Layout: {
      bodyBg: tokens.colors.bg,
      headerBg: tokens.colors.surface,
      siderBg: tokens.colors.surface,
    },
    Menu: {
      itemSelectedBg: 'linear-gradient(135deg, #EFF6FF, #DBEAFE)',
      itemSelectedColor: tokens.colors.primary,
      itemHoverBg: '#F1F5F9',
      itemHoverColor: tokens.colors.textBody,
    },
    Card: {
      borderRadius: 16,
      colorBorderSecondary: tokens.colors.border,
    },
    Button: {
      borderRadius: 12,
      borderRadiusSM: 8,
      primaryShadow: '0 1px 3px rgba(37, 99, 235, 0.2)',
    },
    Input: {
      borderRadius: 12,
      colorBorder: tokens.colors.border,
    },
    Select: {
      borderRadius: 12,
    },
    Table: {
      headerBg: '#FAFBFC',
      headerColor: tokens.colors.textSecondary,
      rowHoverBg: '#F8FAFC',
      borderColor: '#F1F5F9',
    },
    Tag: {
      borderRadius: 9999,
    },
  },
};
