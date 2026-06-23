export const tokens = {
  colors: {
    // Minimalist warm monochrome foundation
    primary: '#111111',
    primaryLight: '#2F3437',
    primaryDark: '#000000',

    // Muted semantic spot pastels (text / background pairs)
    success: '#346538',
    successSoft: '#EDF3EC',
    warning: '#956400',
    warningSoft: '#FBF3DB',
    danger: '#9F2F2D',
    dangerSoft: '#FDEBEC',
    info: '#1F6C9F',
    infoSoft: '#E1F3FE',
    neutral: '#787774',
    neutralSoft: '#F1F5F9',

    // Surfaces & structure
    bg: '#F7F6F3',
    surface: '#FFFFFF',
    border: '#EAEAEA',
    borderSubtle: 'rgba(0, 0, 0, 0.06)',

    // Typography
    textPrimary: '#111111',
    textBody: '#2F3437',
    textSecondary: '#787774',
    textMuted: '#9F9F9A',

    // Primary action: keep the previous blue for buttons
    buttonPrimary: '#2563EB',
    buttonPrimaryHover: '#1D4ED8',
    buttonPrimaryActive: '#1E40AF',

    // User avatars / main user icons use the same brand blue
    userAvatar: '#2563EB',

    // Code / terminal
    logBg: '#0F172A',
    logText: '#34D399',
  },
  layout: {
    sidebarWidth: 240,
    headerHeight: 64,
    pagePadding: 24,
    cardRadius: 12,
    buttonRadius: 6,
    inputRadius: 6,
  },
  font: {
    sans: '"SF Pro Display", "Geist Sans", "Helvetica Neue", "Switzer", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif',
    mono: '"Geist Mono", "SF Mono", "JetBrains Mono", "Fira Code", Consolas, monospace',
  },
  shadow: {
    card: '0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.03)',
    cardHover: '0 2px 8px rgba(0, 0, 0, 0.04)',
    buttonPrimary: '0 1px 3px rgba(37, 99, 235, 0.2)',
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
    borderRadius: tokens.layout.buttonRadius,
    borderRadiusSM: 4,
    borderRadiusLG: tokens.layout.cardRadius,
    fontFamily: tokens.font.sans,
  },
  components: {
    Layout: {
      bodyBg: tokens.colors.bg,
      headerBg: tokens.colors.surface,
      siderBg: tokens.colors.surface,
    },
    Menu: {
      itemSelectedBg: tokens.colors.infoSoft,
      itemSelectedColor: tokens.colors.info,
      itemHoverBg: tokens.colors.bg,
      itemHoverColor: tokens.colors.textBody,
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
      activeBorderColor: tokens.colors.textSecondary,
      hoverBorderColor: '#D1D1CE',
      activeShadow: '0 0 0 2px rgba(17, 17, 17, 0.06)',
    },
    Select: {
      borderRadius: tokens.layout.inputRadius,
      colorBorder: tokens.colors.border,
    },
    Table: {
      headerBg: '#F9F9F8',
      headerColor: tokens.colors.textSecondary,
      rowHoverBg: tokens.colors.bg,
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
