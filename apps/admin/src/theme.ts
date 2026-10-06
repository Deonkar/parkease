import { colors, duration, radius } from '@parkease/tokens';
import type { ThemeConfig } from 'antd';

/** Direction "Wayfinder Ops" (chosen 2026-10-07): the mobile Wayfinder tokens, applied to AntD. */
export const theme: ThemeConfig = {
  token: {
    colorPrimary: colors.primary,
    colorInfo: colors.info,
    colorSuccess: colors.available,
    colorWarning: colors.warning,
    colorError: colors.error,
    colorText: colors.text,
    colorTextSecondary: colors.textSecondary,
    colorBorder: colors.border,
    colorBgLayout: colors.surfaceSecondary,
    colorBgContainer: colors.surface,
    borderRadius: radius.md,
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    motionDurationFast: `${String(duration.fast / 1000)}s`,
    motionDurationMid: `${String(duration.base / 1000)}s`,
    motionDurationSlow: `${String(duration.slow / 1000)}s`,
  },
  components: {
    Layout: { siderBg: colors.surface, headerBg: colors.surface },
    Menu: { itemSelectedBg: colors.primarySoft, itemSelectedColor: colors.primaryDark },
    Table: { headerBg: colors.surfaceTertiary },
  },
};
