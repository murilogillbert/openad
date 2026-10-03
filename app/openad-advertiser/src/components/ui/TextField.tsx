import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { colors, font, HIT, radius, spacing } from '@/theme/tokens';
import { Icon } from './primitives';

export interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string;
  hint?: string;
  /** Campo de senha com botão mostrar/ocultar. */
  password?: boolean;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, password, style, editable = true, ...rest },
  ref,
) {
  const [hidden, setHidden] = useState(true);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
      <View
        style={[
          styles.inputRow,
          focused && styles.focused,
          !!error && styles.errorBorder,
          !editable && { backgroundColor: colors.surfaceAlt },
        ]}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          placeholderTextColor={colors.textSoft}
          secureTextEntry={password ? hidden : rest.secureTextEntry}
          autoCapitalize={password ? 'none' : rest.autoCapitalize}
          autoCorrect={password ? false : rest.autoCorrect}
          editable={editable}
          maxFontSizeMultiplier={1.4}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[styles.input, rest.multiline && styles.multiline, style]}
        />
        {password ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Mostrar senha' : 'Ocultar senha'}
            onPress={() => setHidden((h) => !h)}
            hitSlop={8}
            style={styles.eye}
          >
            <Icon name={hidden ? 'eye-outline' : 'eye-off-outline'} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.4}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint} maxFontSizeMultiplier={1.4}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: font.small, fontWeight: '600', color: colors.text },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: HIT + 4,
  },
  focused: { borderColor: colors.blue },
  errorBorder: { borderColor: colors.danger },
  input: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: font.body,
    color: colors.text,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  eye: { paddingHorizontal: spacing.md, height: HIT, justifyContent: 'center' },
  error: { fontSize: font.small, color: colors.danger },
  hint: { fontSize: font.small, color: colors.textMuted },
});
