import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { type ColorValue, StyleSheet, Text, type TextProps, type TextStyle, View, type ViewProps, type ViewStyle } from 'react-native';
import { colors, font, radius, spacing, type Tone, toneColors } from '@/theme/tokens';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 20, color = colors.text }: { name: IconName; size?: number; color?: ColorValue }) {
  return <Ionicons name={name} size={size} color={color as string} accessibilityElementsHidden importantForAccessibility="no" />;
}

type Variant = 'title' | 'subtitle' | 'body' | 'bodyStrong' | 'small' | 'caption' | 'label';

const variantStyle: Record<Variant, TextStyle> = {
  title: { fontSize: font.title, fontWeight: '700', color: colors.navy },
  subtitle: { fontSize: font.subtitle, fontWeight: '700', color: colors.navy },
  body: { fontSize: font.body, color: colors.text, lineHeight: 21 },
  bodyStrong: { fontSize: font.body, color: colors.text, fontWeight: '600', lineHeight: 21 },
  small: { fontSize: font.small, color: colors.textMuted, lineHeight: 18 },
  caption: { fontSize: font.tiny, color: colors.textSoft, textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { fontSize: font.small, color: colors.text, fontWeight: '600' },
};

export function AppText({
  variant = 'body',
  color,
  center,
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: string; center?: boolean }) {
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={1.6}
      accessibilityRole={variant === 'title' || variant === 'subtitle' ? 'header' : rest.accessibilityRole}
      style={[variantStyle[variant], color ? { color } : null, center ? { textAlign: 'center' } : null, style]}
    />
  );
}

export function Card({ style, children, ...rest }: ViewProps & { children: ReactNode }) {
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const c = toneColors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      {icon ? <Icon name={icon} size={12} color={c.fg} /> : null}
      <Text style={[styles.badgeText, { color: c.fg }]} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </View>
  );
}

export function Divider({ style }: { style?: ViewStyle }) {
  return <View style={[styles.divider, style]} />;
}

export function Row({ children, style, gap = spacing.sm }: { children: ReactNode; style?: ViewStyle; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Stack({ children, style, gap = spacing.md }: { children: ReactNode; style?: ViewStyle; gap?: number }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

/** Par rótulo/valor (resumos de pedido, repasse etc.). */
export function KeyValue({
  label,
  value,
  strong,
  valueColor,
}: {
  label: string;
  value: string;
  strong?: boolean;
  valueColor?: string;
}) {
  return (
    <View style={styles.kv}>
      <AppText variant={strong ? 'bodyStrong' : 'small'} style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText variant={strong ? 'subtitle' : 'bodyStrong'} color={valueColor} style={{ textAlign: 'right' }}>
        {value}
      </AppText>
    </View>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: Tone }) {
  return (
    <Card style={styles.stat}>
      <AppText variant="caption">{label}</AppText>
      <AppText variant="subtitle" color={tone ? toneColors[tone].fg : undefined} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
      {hint ? <AppText variant="small">{hint}</AppText> : null}
    </Card>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="subtitle" style={{ flex: 1 }}>
        {title}
      </AppText>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  badgeText: { fontSize: font.tiny, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  kv: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  stat: { flex: 1, minWidth: 140, gap: 4, padding: spacing.md },
  section: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
});
