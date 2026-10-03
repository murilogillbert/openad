import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { colors, font, HIT, radius, spacing } from '@/theme/tokens';
import { Icon, type IconName } from './primitives';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

const palette: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.lime, fg: colors.navy },
  secondary: { bg: colors.navy, fg: colors.white },
  outline: { bg: colors.surface, fg: colors.navy, border: colors.border },
  ghost: { bg: 'transparent', fg: colors.blue },
  danger: { bg: colors.danger, fg: colors.white },
};

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg' | 'sm';
  style?: ViewStyle;
  accessibilityHint?: string;
  haptic?: boolean;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  size = 'md',
  style,
  accessibilityHint,
  haptic = true,
}: ButtonProps) {
  const c = palette[variant];
  const inactive = disabled || loading;
  const height = size === 'lg' ? 54 : size === 'sm' ? 36 : HIT + 4;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      hitSlop={size === 'sm' ? 6 : 0}
      onPress={() => {
        if (haptic) Haptics.selectionAsync().catch(() => undefined);
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: c.bg,
          borderColor: c.border ?? c.bg,
          minHeight: height,
          opacity: inactive ? 0.55 : pressed ? 0.85 : 1,
          paddingHorizontal: size === 'sm' ? spacing.md : spacing.lg,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} color={c.fg} /> : null}
          <Text
            style={[styles.text, { color: c.fg, fontSize: size === 'sm' ? font.small : font.body }]}
            maxFontSizeMultiplier={1.4}
            numberOfLines={2}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  text: { fontWeight: '700', textAlign: 'center' },
});
