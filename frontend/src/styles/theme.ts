export const tokens = {
  colors: {
    // Bright tech foundation from ui-design/trace-ship-light-redesign.html
    primary: '#4F46E5',
    primaryLight: '#6366F1',
    primaryDark: '#3730A3',
    cyan: '#06B6D4',
    violet: '#8B5CF6',

    // Semantic spot colors
    success: '#10B981',
    successSoft: '#ECFDF5',
    warning: '#F59E0B',
    warningSoft: '#FFFBEB',
    danger: '#F43F5E',
    dangerSoft: '#FFF1F2',
    info: '#3B82F6',
    infoSoft: '#EFF6FF',
    neutral: '#64748B',
    neutralSoft: '#F1F5F9',

    // Surfaces & structure
    bg: '#F6F7FB',
    surface: '#FFFFFF',
    surfaceGlass: 'rgba(255, 255, 255, 0.70)',
    cardGlass: 'rgba(255, 255, 255, 0.85)',
    border: '#E0E7FF',
    borderSubtle: 'rgba(99, 102, 241, 0.12)',

    // Typography
    textPrimary: '#0F172A',
    textBody: '#334155',
    textSecondary: '#64748B',
    textMuted: '#94A3B8',

    // Primary action
    buttonPrimary: '#4F46E5',
    buttonPrimaryHover: '#6366F1',
    buttonPrimaryActive: '#4338CA',

    // User avatars / main user icons use the same brand gradient start
    userAvatar: '#4F46E5',

    // Code / terminal
    logBg: '#0B1020',
    logText: '#94A3B8',
  },
  layout: {
    sidebarWidth: 244,
    headerHeight: 60,
    pagePadding: 28,
    cardRadius: 12,
    buttonRadius: 8,
    inputRadius: 8,
  },
  font: {
    sans: '"Inter", "Noto Sans SC", "SF Pro Display", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif',
    mono: '"JetBrains Mono", "SF Mono", "Geist Mono", Consolas, monospace',
  },
  shadow: {
    card: '0 0 0 1px rgba(99, 102, 241, 0.12)',
    cardHover: '0 0 0 1px rgba(99,102,241,0.12), 0 16px 40px -10px rgba(79, 70, 229, 0.18)',
    buttonPrimary: '0 1px 2px rgba(79,70,229,0.3), 0 6px 18px -6px rgba(99, 102, 241, 0.55)',
  },
} as const;

export const antdTheme = {
  token: {
    colorPrimary: tokens.colors.primary,
    colorSuccess: tokens.colors.success,
    colorWarning: tokens.colors.warning,
    colorError: tokens.colors.danger,
    colorInfo: tokens.colors.info,
    colorTextBase: tokens.colors.textBody,
    colorBgBase: tokens.colors.surface,
    colorBorder: tokens.colors.border,
    borderRadius: tokens.layout.buttonRadius,
    borderRadiusSM: 4,
    borderRadiusLG: tokens.layout.cardRadius,
    fontFamily: tokens.font.sans,
  },
  components: {
    Layout: {
      bodyBg: tokens.colors.bg,
      headerBg: tokens.colors.surfaceGlass,
      siderBg: tokens.colors.surfaceGlass,
    },
    Menu: {
      itemSelectedBg: 'rgba(79,70,229,0.10)',
      itemSelectedColor: tokens.colors.primary,
      itemHoverBg: 'rgba(238,242,255,0.60)',
      itemHoverColor: tokens.colors.primary,
      activeBarWidth: 0,
    },
    Card: {
      borderRadius: tokens.layout.cardRadius,
      colorBorderSecondary: tokens.colors.border,
    },
    Button: {
      borderRadius: tokens.layout.buttonRadius,
      borderRadiusSM: 4,
      colorPrimary: tokens.colors.buttonPrimary,
      primaryShadow: tokens.shadow.buttonPrimary,
      defaultBg: tokens.colors.surface,
      defaultColor: tokens.colors.textBody,
      defaultBorder: tokens.colors.border,
    },
    Input: {
      borderRadius: tokens.layout.inputRadius,
      colorBorder: tokens.colors.border,
      activeBorderColor: tokens.colors.buttonPrimary,
      hoverBorderColor: tokens.colors.buttonPrimary,
      activeShadow: '0 0 0 2px rgba(37, 99, 235, 0.12)',
    },
    Select: {
      borderRadius: tokens.layout.inputRadius,
      colorBorder: tokens.colors.border,
      activeBorderColor: tokens.colors.buttonPrimary,
      hoverBorderColor: tokens.colors.buttonPrimary,
    },
    Radio: {
      colorPrimary: tokens.colors.buttonPrimary,
    },
    Checkbox: {
      colorPrimary: tokens.colors.buttonPrimary,
    },
    Switch: {
      colorPrimary: tokens.colors.buttonPrimary,
    },
    Table: {
      headerBg: '#F9F9F8',
      headerColor: tokens.colors.textSecondary,
      rowHoverBg: 'rgba(238,242,255,0.40)',
      borderColor: tokens.colors.border,
    },
    Tag: {
      borderRadius: 9999,
    },
    Tabs: {
      inkBarColor: tokens.colors.primary,
      itemSelectedColor: tokens.colors.primary,
      itemHoverColor: tokens.colors.textBody,
      itemColor: tokens.colors.textSecondary,
    },
    Modal: {
      borderRadius: tokens.layout.cardRadius,
    },
    Drawer: {
      borderRadius: 0,
    },
  },
};
