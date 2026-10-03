/** Tokens de design — mesma paleta do hub web (src/shared/styles/theme.css). */
export const colors = {
  navy: '#0A1726',
  navySoft: '#10243F',
  blue: '#1F7BFF',
  blueSoft: '#E0EEFF',
  lime: '#B5DC2F',
  limeDark: '#6E9A1B',
  limeSoft: '#EEF8D2',
  bg: '#F7F9FB',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F5F9',
  border: '#E5EAF0',
  text: '#1F2937',
  textMuted: '#6B7280',
  textSoft: '#9CA3AF',
  success: '#2E9E5B',
  successSoft: '#E3F5EA',
  warning: '#B77904',
  warningSoft: '#FDF3DC',
  danger: '#D6453F',
  dangerSoft: '#FCE8E7',
  white: '#FFFFFF',
  overlay: 'rgba(10, 23, 38, 0.55)',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const font = {
  title: 24,
  subtitle: 18,
  body: 15,
  small: 13,
  tiny: 11,
} as const;

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

export const toneColors: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: colors.surfaceAlt, fg: colors.textMuted },
  info: { bg: colors.blueSoft, fg: colors.blue },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  brand: { bg: colors.limeSoft, fg: colors.limeDark },
};

/** Área mínima de toque recomendada (Apple HIG 44pt / Material 48dp). */
export const HIT = 44;
