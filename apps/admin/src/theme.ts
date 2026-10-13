import { colors, duration, radius } from '@parkease/tokens';
import type { ThemeConfig } from 'antd';

/** Direction "Wayfinder Ops" (chosen 2026-10-07): the mobile Wayfinder tokens, applied to AntD. */
export const theme: ThemeConfig = {
  token: {
    colorPrimary: colors.primary,
    colorInfo: colors.info,
    colorSuccess: colors.available,
    colorWarning: colors.warning,
    // The ink red, not the alert red: #DC2626 on a pale tint is 4.4:1, under AA for tag text.
    colorError: colors.errorInk,
    colorText: colors.text,
    colorTextSecondary: colors.textSecondary,
    // AntD's own greys and derived status tints fall under WCAG AA on white (S-157, axe):
    // secondary text was #8c8c8c (3.4:1), a success tag sat on a mid-tone it derived (2.6:1).
    colorTextDescription: colors.textSecondary,
    colorTextTertiary: colors.textTertiary,
    colorSuccessBg: colors.availableSoft,
    colorSuccessBorder: colors.availableVivid,
    colorErrorBg: colors.errorLight,
    colorInfoBg: colors.infoLight,
    colorWarningBg: colors.warningLight,
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
