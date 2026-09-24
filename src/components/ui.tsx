import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';

import { MaxContentWidth, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { DisplayStatus } from '@/lib/types';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type AppTextProps = TextProps & {
  variant?: 'title' | 'heading' | 'body' | 'label' | 'caption' | 'amount';
  color?: ThemeColor;
};

export function AppText({ variant = 'body', color, style, ...rest }: AppTextProps) {
  const theme = useTheme();
  return (
    <Text
      style={[
        styles[variant],
        { color: theme[color ?? (variant === 'caption' || variant === 'label' ? 'textSecondary' : 'text')] },
        style,
      ]}
      {...rest}
    />
  );
}

export function Screen({ children, contentContainerStyle, ...rest }: ScrollViewProps) {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[styles.screen, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      {...rest}>
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.backgroundElement }, style]}>{children}</View>;
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <AppText variant="label">{title}</AppText>
        {action}
      </View>
      <Card>{children}</Card>
    </View>
  );
}

type FieldProps = TextInputProps & { label: string; hint?: string; error?: string };

export function Field({ label, hint, error, style, ...rest }: FieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <AppText variant="caption">{label}</AppText>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { color: theme.text, borderColor: error ? theme.danger : theme.border, backgroundColor: theme.background },
          rest.multiline && styles.multiline,
          style,
        ]}
        {...rest}
      />
      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption">{hint}</AppText>
      ) : null}
    </View>
  );
}

export function ToggleRow({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (v: boolean) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.toggleRow}>
      <AppText>{label}</AppText>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: theme.tint }} />
    </View>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style }: ButtonProps) {
  const theme = useTheme();
  const bg = {
    primary: theme.tint,
    secondary: theme.backgroundSelected,
    danger: theme.danger,
    ghost: 'transparent',
  }[variant];
  const fg = variant === 'primary' ? theme.onTint : variant === 'danger' ? '#fff' : variant === 'ghost' ? theme.tint : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

type ListRowProps = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  icon?: IconName;
  onPress?: () => void;
  last?: boolean;
};

export function ListRow({ title, subtitle, right, icon, onPress, last }: ListRowProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.listRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
        pressed && { opacity: 0.6 },
      ]}>
      {icon ? <Ionicons name={icon} size={20} color={theme.tint} /> : null}
      <View style={{ flex: 1 }}>
        <AppText numberOfLines={1}>{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} /> : null}
    </Pressable>
  );
}

const STATUS_COLOR: Record<DisplayStatus, ThemeColor> = {
  draft: 'textSecondary',
  sent: 'tint',
  partial: 'warning',
  paid: 'success',
  overdue: 'danger',
  void: 'textSecondary',
  accepted: 'success',
  declined: 'danger',
  converted: 'success',
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const theme = useTheme();
  const color = theme[STATUS_COLOR[status]];
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

export function ProBadge() {
  const theme = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: theme.tint, borderColor: theme.tint }]}>
      <Text style={[styles.badgeText, { color: theme.onTint }]}>PRO</Text>
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && { backgroundColor: theme.background }]}>
            <AppText variant="caption" color={selected ? 'text' : 'textSecondary'} style={{ fontWeight: '600' }}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message: string; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={48} color={theme.textSecondary} />
      <AppText variant="heading">{title}</AppText>
      <AppText variant="caption" style={{ textAlign: 'center' }}>
        {message}
      </AppText>
      {action}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 16 },
  label: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  caption: { fontSize: 13 },
  amount: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  screen: {
    padding: Spacing.three,
    paddingBottom: Spacing.six * 2,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  card: { borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  section: { gap: Spacing.two },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.one },
  field: { gap: Spacing.one, flex: 1 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: 12,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
    minHeight: 46,
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 10 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  segmented: { flexDirection: 'row', borderRadius: 10, padding: 3 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8 },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six, paddingHorizontal: Spacing.four },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
});
