export const colors = {
  primary: '#4F46E5',
  primaryLight: '#818CF8',
  primaryDark: '#3730A3',

  surface: '#FFFFFF',
  surfaceSecondary: '#F9FAFB',
  surfaceTertiary: '#F3F4F6',

  text: '#111827',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  textInverse: '#FFFFFF',

  border: '#E5E7EB',
  borderFocused: '#4F46E5',

  error: '#DC2626',
  errorLight: '#FEF2F2',
  success: '#16A34A',
  successLight: '#F0FDF4',
  warning: '#D97706',
  warningLight: '#FFFBEB',
  info: '#2563EB',
  infoLight: '#EFF6FF',

  skeleton: '#E5E7EB',
  skeletonHighlight: '#F3F4F6',

  tabActive: '#4F46E5',
  tabInactive: '#9CA3AF',

  overlay: 'rgba(0, 0, 0, 0.5)',
} as const;

export type Colors = typeof colors;
