import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSequence, withTiming, Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { money, sanitizeDecimal } from '@/lib/format';
import type { InputState, ServiceKind } from '@/lib/types';

export const F = {
  body: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  display: 'BarlowSemiCondensed_700Bold',
  displaySemi: 'BarlowSemiCondensed_600SemiBold',
} as const;

export const isWeb = Platform.OS === 'web';
export const WEB_TOP = 67;
export const WEB_BOTTOM = 34;
/** Height of the Prev / Next / Done bar shown above the keyboard (react-native-keyboard-controller's KeyboardToolbar). */
export const KEYBOARD_TOOLBAR_HEIGHT = 42;
/** What a ref on a Field points to (focus, blur). */
export type TextInputHandle = React.ComponentRef<typeof TextInput>;

export function haptic(kind: 'tap' | 'select' | 'success' | 'warn' = 'tap') {
  if (Platform.OS === 'web') return;
  if (kind === 'select') Haptics.selectionAsync().catch(() => undefined);
  else if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  else if (kind === 'warn') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

// ---------- Text ----------

type Variant = 'display' | 'hero' | 'title' | 'h2' | 'h3' | 'body' | 'bodyStrong' | 'small' | 'smallStrong' | 'label' | 'num' | 'numLg';

const variants: Record<Variant, TextStyle> = {
  display: { fontFamily: F.display, fontSize: 46, lineHeight: 50, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  hero: { fontFamily: F.display, fontSize: 34, lineHeight: 38, letterSpacing: -0.3 },
  title: { fontFamily: F.display, fontSize: 30, lineHeight: 34, letterSpacing: -0.2 },
  h2: { fontFamily: F.displaySemi, fontSize: 21, lineHeight: 26 },
  h3: { fontFamily: F.semibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: F.body, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: F.semibold, fontSize: 15, lineHeight: 21 },
  small: { fontFamily: F.body, fontSize: 13, lineHeight: 18 },
  smallStrong: { fontFamily: F.semibold, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: F.semibold, fontSize: 11.5, lineHeight: 15, letterSpacing: 0.9, textTransform: 'uppercase' },
  num: { fontFamily: F.displaySemi, fontSize: 18, lineHeight: 22, fontVariant: ['tabular-nums'] },
  numLg: { fontFamily: F.display, fontSize: 26, lineHeight: 30, fontVariant: ['tabular-nums'] },
};

export function T({ v = 'body', color, muted, style, children, ...rest }: TextProps & { v?: Variant; color?: string; muted?: boolean }) {
  const c = useColors();
  return (
    <Text style={[variants[v], { color: color ?? (muted ? c.mutedForeground : c.foreground) }, style]} {...rest}>
      {children}
    </Text>
  );
}

// ---------- Layout ----------

export function Header({
  title,
  subtitle,
  back = true,
  right,
  large,
  onBack,
  modal,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: React.ReactNode;
  large?: boolean;
  onBack?: () => void;
  /** iOS page-sheet modals sit below the status bar already. */
  modal?: boolean;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const top = isWeb ? WEB_TOP + 6 : modal && Platform.OS === 'ios' ? 12 : insets.top + 6;
  return (
    <View style={{ paddingTop: top, paddingHorizontal: 16, paddingBottom: 8, backgroundColor: c.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
        {back ? (
          <IconButton
            icon="chevron-left"
            label="Back"
            testID="header-back"
            onPress={() => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace('/'))}
          />
        ) : null}
        <View style={{ flex: 1, marginLeft: back ? 6 : 4 }}>
          {!large ? (
            <T v="h3" numberOfLines={1}>
              {title}
            </T>
          ) : null}
          {!large && subtitle ? (
            <T v="small" muted numberOfLines={1}>
              {subtitle}
            </T>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{right}</View>
      </View>
      {large ? (
        <View style={{ paddingHorizontal: 4, paddingTop: 2 }}>
          <T v="title">{title}</T>
          {subtitle ? (
            <T v="body" muted style={{ marginTop: 2 }}>
              {subtitle}
            </T>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function Screen({
  title,
  subtitle,
  back = true,
  right,
  large,
  children,
  footer,
  scroll = true,
  onBack,
  contentStyle,
  tab,
  modal,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: React.ReactNode;
  large?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  scroll?: boolean;
  onBack?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  tab?: boolean;
  modal?: boolean;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = footer ? 24 : tab ? (isWeb ? 84 : insets.bottom + 70) + 24 : (isWeb ? WEB_BOTTOM : insets.bottom) + 32;
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Header title={title} subtitle={subtitle} back={back} right={right} large={large} onBack={onBack} modal={modal} />
      {scroll ? (
        <KeyboardAwareScrollViewCompat
          style={{ flex: 1 }}
          contentContainerStyle={[{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: bottomPad, gap: 14 }, contentStyle]}
          bottomOffset={(footer ? 96 : 16) + KEYBOARD_TOOLBAR_HEIGHT}
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </KeyboardAwareScrollViewCompat>
      ) : (
        <View style={[{ flex: 1, paddingHorizontal: 16 }, contentStyle]}>{children}</View>
      )}
      {footer ? <Footer>{footer}</Footer> : null}
    </View>
  );
}

/** The main action bar. On iPhone it rides above the keyboard and its Done bar, so the main button is never hidden. */
export function Footer({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const padBottom = (isWeb ? WEB_BOTTOM : Math.max(insets.bottom, 12)) + 4;
  const body = (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: padBottom,
        backgroundColor: c.background,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        gap: 10,
      }}
    >
      {children}
    </View>
  );
  if (isWeb) return body;
  // With the keyboard open the home-indicator padding tucks behind the toolbar, leaving a 12 pt gap above it.
  return <KeyboardStickyView offset={{ closed: 0, opened: padBottom - 12 - KEYBOARD_TOOLBAR_HEIGHT }}>{body}</KeyboardStickyView>;
}

export function Card({ children, style, onPress, testID, tone }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; testID?: string; tone?: 'uncertain' | 'confirm' | 'alt' }) {
  const c = useColors();
  const toneStyle: ViewStyle =
    tone === 'uncertain'
      ? { backgroundColor: c.uncertainSoft, borderColor: c.uncertainBorder, borderStyle: 'dashed', borderWidth: 1.2 }
      : tone === 'confirm'
        ? { backgroundColor: c.confirmSoft, borderColor: 'transparent' }
        : tone === 'alt'
          ? { backgroundColor: c.cardAlt, borderColor: c.border }
          : { backgroundColor: c.card, borderColor: c.border };
  const base: ViewStyle = { borderRadius: c.radius + 4, borderWidth: StyleSheet.hairlineWidth, padding: 16, ...toneStyle };
  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={() => {
          haptic();
          onPress();
        }}
        style={({ pressed }) => [base, { opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] }, style]}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View testID={testID} style={[base, style]}>
      {children}
    </View>
  );
}

export function HeroCard({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ backgroundColor: c.hero, borderRadius: c.radius + 8, padding: 20, borderWidth: 1, borderColor: c.heroBorder, overflow: 'hidden' }, style]}>{children}</View>;
}

export function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, marginBottom: -4, paddingHorizontal: 4 }}>
      <T v="label" muted>
        {children}
      </T>
      {right}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: inset }} />;
}

// ---------- Buttons ----------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'lime' | 'outline';

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  size = 'lg',
  testID,
  style,
  flex,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: React.ComponentProps<typeof Feather>['name'];
  loading?: boolean;
  disabled?: boolean;
  size?: 'lg' | 'md' | 'sm';
  testID?: string;
  style?: StyleProp<ViewStyle>;
  flex?: boolean;
}) {
  const c = useColors();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: c.primary, fg: c.primaryForeground, border: c.primary },
    secondary: { bg: c.secondary, fg: c.secondaryForeground, border: c.secondary },
    ghost: { bg: 'transparent', fg: c.foreground, border: 'transparent' },
    danger: { bg: c.destructiveSoft, fg: c.destructive, border: c.destructiveSoft },
    lime: { bg: c.accent, fg: c.accentForeground, border: c.accent },
    outline: { bg: 'transparent', fg: c.foreground, border: c.input },
  };
  const p = palette[variant];
  const h = size === 'lg' ? 54 : size === 'md' ? 44 : 34;
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={() => {
        haptic();
        onPress();
      }}
      style={({ pressed }) => [
        {
          minHeight: h,
          paddingVertical: size === 'sm' ? 6 : 10,
          borderRadius: size === 'sm' ? 10 : c.radius,
          backgroundColor: p.bg,
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor: p.border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          paddingHorizontal: size === 'sm' ? 12 : 18,
          opacity: off ? 0.45 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        flex ? { flex: 1 } : null,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={p.fg} /> : icon ? <Feather name={icon} size={size === 'sm' ? 15 : 18} color={p.fg} /> : null}
      <Text style={{ fontFamily: F.semibold, fontSize: size === 'sm' ? 13.5 : 16, color: p.fg, textAlign: 'center', flexShrink: 1 }} numberOfLines={2}>
        {title}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  testID,
  tone = 'default',
  size = 40,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  onPress: () => void;
  label: string;
  testID?: string;
  tone?: 'default' | 'filled' | 'hero';
  size?: number;
}) {
  const c = useColors();
  const bg = tone === 'filled' ? c.secondary : tone === 'hero' ? c.heroGlass : 'transparent';
  const fg = tone === 'hero' ? c.heroForeground : c.foreground;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={Math.max(8, Math.ceil((44 - size) / 2))}
      onPress={() => {
        haptic();
        onPress();
      }}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, opacity: pressed ? 0.6 : 1 })}
    >
      <Feather name={icon} size={20} color={fg} />
    </Pressable>
  );
}

export function TextLink({ title, onPress, testID, color, icon }: { title: string; onPress: () => void; testID?: string; color?: string; icon?: React.ComponentProps<typeof Feather>['name'] }) {
  const c = useColors();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} onPress={onPress} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 })}>
      {icon ? <Feather name={icon} size={15} color={color ?? c.foreground} /> : null}
      <Text style={{ fontFamily: F.semibold, fontSize: 14, color: color ?? c.foreground, textDecorationLine: icon ? 'none' : 'underline' }}>{title}</Text>
    </Pressable>
  );
}

// ---------- Chips & segmented ----------

export function Chip({
  label,
  selected,
  onPress,
  icon,
  mci,
  testID,
  tone,
  small,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: React.ComponentProps<typeof Feather>['name'];
  mci?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  testID?: string;
  tone?: 'uncertain' | 'confirm' | 'hero';
  small?: boolean;
}) {
  const c = useColors();
  let bg = selected ? c.primary : c.card;
  let fg = selected ? c.primaryForeground : c.foreground;
  let border = selected ? c.primary : c.input;
  let borderStyle: 'solid' | 'dashed' = 'solid';
  if (tone === 'uncertain') {
    bg = c.uncertainSoft;
    fg = c.uncertain;
    border = c.uncertainBorder;
    borderStyle = 'dashed';
  } else if (tone === 'confirm') {
    bg = c.confirmSoft;
    fg = c.confirm;
    border = 'transparent';
  } else if (tone === 'hero') {
    bg = selected ? c.accent : c.heroGlass;
    fg = selected ? c.accentForeground : c.heroForeground;
    border = selected ? c.accent : c.heroGlassBorder;
  }
  const content = (
    <>
      {mci ? <MaterialCommunityIcons name={mci} size={small ? 15 : 18} color={fg} /> : null}
      {icon ? <Feather name={icon} size={small ? 13 : 15} color={fg} /> : null}
      <Text style={{ fontFamily: F.semibold, fontSize: small ? 12.5 : 14, color: fg }} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  const style: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: small ? 10 : 14,
    height: small ? 28 : 38,
    borderRadius: 999,
    backgroundColor: bg,
    borderWidth: 1,
    borderColor: border,
    borderStyle,
  };
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      hitSlop={small ? { top: 8, bottom: 8, left: 4, right: 4 } : 4}
      onPress={() => {
        haptic('select');
        onPress();
      }}
      style={({ pressed }) => [style, { opacity: pressed ? 0.75 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  testID,
  compact,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
  testID?: string;
  compact?: boolean;
}) {
  const c = useColors();
  return (
    <View testID={testID} style={{ flexDirection: 'row', backgroundColor: c.muted, borderRadius: 12, padding: 3, gap: 3 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={testID ? `${testID}-${o.value}` : undefined}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on }}
            hitSlop={compact ? { top: 6, bottom: 6 } : undefined}
            onPress={() => {
              if (!on) {
                haptic('select');
                onChange(o.value);
              }
            }}
            style={{
              flex: 1,
              height: compact ? 32 : 38,
              borderRadius: 9,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? c.card : 'transparent',
              ...(on ? { shadowColor: c.shadow, shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : null),
            }}
          >
            <Text style={{ fontFamily: on ? F.semibold : F.medium, fontSize: compact ? 12.5 : 13.5, color: on ? c.foreground : c.mutedForeground }} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- Inputs ----------

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  prefix,
  suffix,
  decimal,
  maxDecimals = 4,
  onOtherText,
  keyboardType,
  multiline,
  hint,
  error,
  tone,
  testID,
  autoFocus,
  maxLength,
  onBlur,
  autoCapitalize,
  style,
  big,
  inputMode,
  textContentType,
  inputRef,
  accessibilityLabel,
  returnKeyType,
  onSubmitEditing,
}: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  decimal?: boolean;
  maxDecimals?: number;
  /** Decimal fields: text that is not a plain number (a pasted "24x36") goes here instead of being ignored. */
  onOtherText?: (t: string) => void;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  hint?: string;
  error?: string | null;
  tone?: 'uncertain' | 'confirm';
  testID?: string;
  autoFocus?: boolean;
  maxLength?: number;
  onBlur?: () => void;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  style?: StyleProp<ViewStyle>;
  big?: boolean;
  inputMode?: 'text' | 'email' | 'tel' | 'decimal' | 'numeric';
  textContentType?: React.ComponentProps<typeof TextInput>['textContentType'];
  inputRef?: React.Ref<TextInputHandle>;
  accessibilityLabel?: string;
  returnKeyType?: React.ComponentProps<typeof TextInput>['returnKeyType'];
  onSubmitEditing?: () => void;
}) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? c.destructive : focused ? c.foreground : tone === 'uncertain' ? c.uncertainBorder : c.input;
  const bg = tone === 'uncertain' ? c.uncertainSoft : c.card;
  return (
    <View style={style}>
      {label ? (
        <T v="smallStrong" muted style={{ marginBottom: 6, marginLeft: 2 }}>
          {label}
        </T>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          borderWidth: focused ? 1.5 : 1,
          borderStyle: tone === 'uncertain' && !focused ? 'dashed' : 'solid',
          borderColor,
          backgroundColor: bg,
          borderRadius: 12,
          paddingHorizontal: 12,
          minHeight: big ? 56 : 48,
        }}
      >
        {prefix ? (
          <Text numberOfLines={1} style={{ fontFamily: F.semibold, fontSize: big ? 20 : 16, color: c.mutedForeground, marginRight: 4, flexShrink: 0 }}>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={inputRef}
          testID={testID}
          accessibilityLabel={[accessibilityLabel ?? label ?? placeholder, !accessibilityLabel && suffix ? suffix : null].filter(Boolean).join(', ')}
          accessibilityHint={error ?? hint ?? undefined}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          value={value}
          onChangeText={(t) => {
            if (!decimal) return onChangeText(t);
            // A change that would alter the number's meaning is ignored rather than guessed at. Deleting
            // is always allowed, even from a converted value with more decimals than this field takes.
            const clean = sanitizeDecimal(t, t.length < value.length ? 12 : maxDecimals);
            if (clean != null) onChangeText(clean);
            else onOtherText?.(t);
          }}
          placeholder={placeholder}
          placeholderTextColor={c.faint}
          keyboardType={keyboardType ?? (decimal ? 'decimal-pad' : 'default')}
          inputMode={inputMode ?? (decimal ? 'decimal' : undefined)}
          multiline={multiline}
          autoFocus={autoFocus}
          maxLength={maxLength}
          autoCapitalize={autoCapitalize}
          textContentType={textContentType}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: big ? F.displaySemi : F.medium,
            fontSize: big ? 24 : 16,
            color: tone === 'uncertain' ? c.uncertain : c.foreground,
            paddingVertical: multiline ? 12 : 0,
            minHeight: multiline ? 96 : undefined,
            textAlignVertical: multiline ? 'top' : 'center',
            ...(isWeb ? ({ outlineStyle: 'none' } as object) : null),
          }}
        />
        {suffix ? (
          <Text numberOfLines={1} style={{ fontFamily: F.medium, fontSize: 14, color: c.mutedForeground, marginLeft: 6, flexShrink: 0 }}>
            {suffix}
          </Text>
        ) : null}
        {tone === 'confirm' ? <Tick /> : null}
      </View>
      {error ? (
        <T v="small" color={c.destructive} style={{ marginTop: 6, marginLeft: 2 }}>
          {error}
        </T>
      ) : hint ? (
        <T v="small" muted style={{ marginTop: 6, marginLeft: 2 }}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

export function Tick({ size = 18 }: { size?: number }) {
  const c = useColors();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.confirm, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name="check" size={size * 0.62} color={c.card} />
    </View>
  );
}

/** A value whose absence must be explicit: amount, none or not sure. Blank never means zero. */
export function StatefulAmount({
  label,
  state,
  amount,
  onChange,
  prefix = '$',
  suffix,
  noneLabel = 'None',
  allowNA,
  testID,
  hint,
  maxDecimals = 2,
}: {
  label: string;
  state: InputState;
  amount: string;
  onChange: (state: InputState, amount: string) => void;
  prefix?: string;
  suffix?: string;
  noneLabel?: string;
  allowNA?: boolean;
  testID?: string;
  hint?: string;
  maxDecimals?: number;
}) {
  const c = useColors();
  const opts: { value: InputState; label: string }[] = [
    { value: 'known_value', label: 'Amount' },
    { value: allowNA ? 'not_applicable' : 'known_zero', label: noneLabel },
    { value: 'unknown', label: 'Not sure' },
  ];
  const seg: InputState = state === 'known_zero' || state === 'not_applicable' ? (allowNA ? 'not_applicable' : 'known_zero') : state;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T v="bodyStrong" style={{ flex: 1 }}>
          {label}
        </T>
        {state === 'unknown' ? <Chip small tone="uncertain" label="Not set" /> : state === 'known_value' && amount ? <Tick /> : null}
      </View>
      <Segmented compact testID={testID ? `${testID}-state` : undefined} options={opts} value={seg} onChange={(v) => onChange(v, v === 'known_value' ? amount : '')} />
      {state === 'known_value' ? (
        <Field testID={testID} value={amount} onChangeText={(t) => onChange('known_value', t)} prefix={prefix} suffix={suffix} decimal maxDecimals={maxDecimals} placeholder="0" error={null} />
      ) : null}
      {hint ? (
        <T v="small" muted>
          {hint}
        </T>
      ) : null}
      {state === 'known_value' && !amount ? (
        <T v="small" color={c.uncertain}>
          Enter an amount, or choose {noneLabel.toLowerCase()} or not sure.
        </T>
      ) : null}
    </View>
  );
}

// ---------- Rows ----------

export function Row({
  icon,
  title,
  subtitle,
  value,
  onPress,
  testID,
  danger,
  chevron = true,
  right,
}: {
  icon?: React.ComponentProps<typeof Feather>['name'];
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  testID?: string;
  danger?: boolean;
  chevron?: boolean;
  right?: React.ReactNode;
}) {
  const c = useColors();
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, minHeight: 52 }}>
      {icon ? (
        <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: danger ? c.destructiveSoft : c.muted, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name={icon} size={16} color={danger ? c.destructive : c.foreground} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <T v="bodyStrong" color={danger ? c.destructive : undefined}>
          {title}
        </T>
        {subtitle ? (
          <T v="small" muted>
            {subtitle}
          </T>
        ) : null}
      </View>
      {value ? (
        <T v="body" muted numberOfLines={1} style={{ maxWidth: '45%' }}>
          {value}
        </T>
      ) : null}
      {right}
      {onPress && chevron ? <Feather name="chevron-right" size={18} color={c.faint} /> : null}
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={[title, subtitle, value].filter(Boolean).join(', ')} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {inner}
    </Pressable>
  );
}

export function ToggleRow({ title, subtitle, value, onChange, testID }: { title: string; subtitle?: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
      <View style={{ flex: 1 }}>
        <T v="bodyStrong">{title}</T>
        {subtitle ? (
          <T v="small" muted>
            {subtitle}
          </T>
        ) : null}
      </View>
      <Switch
        testID={testID}
        accessibilityLabel={title}
        value={value}
        onValueChange={(v) => {
          haptic('select');
          onChange(v);
        }}
        trackColor={{ false: c.input, true: c.confirm }}
        thumbColor={Platform.OS === 'ios' ? undefined : c.heroForeground}
        {...(Platform.OS === 'web' ? ({ activeThumbColor: c.heroForeground } as object) : {})}
      />
    </View>
  );
}

// ---------- Feedback ----------

export function Banner({
  tone = 'info',
  title,
  body,
  icon,
  action,
  testID,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'success';
  title: string;
  body?: string;
  icon?: React.ComponentProps<typeof Feather>['name'];
  action?: React.ReactNode;
  testID?: string;
}) {
  const c = useColors();
  const map = {
    info: { bg: c.muted, fg: c.foreground, icon: 'info' as const, border: 'transparent' },
    warn: { bg: c.uncertainSoft, fg: c.uncertain, icon: 'alert-triangle' as const, border: c.uncertainBorder },
    danger: { bg: c.destructiveSoft, fg: c.destructive, icon: 'alert-circle' as const, border: 'transparent' },
    success: { bg: c.confirmSoft, fg: c.confirm, icon: 'check-circle' as const, border: 'transparent' },
  }[tone];
  return (
    <View testID={testID} style={{ backgroundColor: map.bg, borderRadius: 14, padding: 14, borderWidth: tone === 'warn' ? 1 : 0, borderStyle: 'dashed', borderColor: map.border, gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Feather name={icon ?? map.icon} size={17} color={map.fg} style={{ marginTop: 2 }} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="bodyStrong" color={tone === 'info' ? undefined : map.fg}>
            {title}
          </T>
          {body ? <T v="small">{body}</T> : null}
        </View>
      </View>
      {action ? <View style={{ paddingLeft: 27 }}>{action}</View> : null}
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: React.ComponentProps<typeof Feather>['name']; title: string; body?: string; action?: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 36, paddingHorizontal: 24, gap: 10 }}>
      <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={icon} size={24} color={c.mutedForeground} />
      </View>
      <T v="h3" style={{ textAlign: 'center' }}>
        {title}
      </T>
      {body ? (
        <T v="body" muted style={{ textAlign: 'center' }}>
          {body}
        </T>
      ) : null}
      {action ? <View style={{ marginTop: 6, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export const SERVICE_ICON: Record<ServiceKind, React.ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  driveway: 'road-variant',
  walkway: 'walk',
  patio: 'view-grid-outline',
  stairs: 'stairs',
  custom: 'spray',
};

export function ServiceGlyph({ kind, size = 36, tone = 'card' }: { kind: ServiceKind; size?: number; tone?: 'card' | 'hero' }) {
  const c = useColors();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        backgroundColor: tone === 'hero' ? c.heroAccentSoft : c.muted,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <MaterialCommunityIcons name={SERVICE_ICON[kind]} size={size * 0.55} color={tone === 'hero' ? c.accent : c.foreground} />
    </View>
  );
}

/** Total with the "clean pass": a lime squeegee line sweeps under the number whenever it changes. */
export function PassMoney({ cents, color, size = 'display', testID }: { cents: number | null; color?: string; size?: 'display' | 'hero' | 'numLg'; testID?: string }) {
  const c = useColors();
  const sweep = useSharedValue(0);
  const fade = useSharedValue(0);
  useEffect(() => {
    if (cents == null) return;
    sweep.set(0);
    fade.set(1);
    sweep.set(withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }));
    fade.set(withSequence(withTiming(1, { duration: 520 }), withTiming(0, { duration: 380 })));
  }, [cents, sweep, fade]);
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: sweep.get() }], opacity: fade.get() }));
  const text = cents == null ? '\u2014' : money(cents);
  return (
    <View style={{ alignSelf: 'flex-start' }}>
      <Animated.Text key={text} entering={FadeIn.duration(260)} testID={testID} style={[variants[size], { color: color ?? c.foreground }]}>
        {text}
      </Animated.Text>
      <Animated.View style={[{ height: 3, borderRadius: 2, backgroundColor: c.accent, marginTop: 2, transformOrigin: 'left' }, bar]} />
    </View>
  );
}

// ---------- Sheet (custom modal, never Alert) ----------

export function Sheet({
  visible,
  onClose,
  title,
  body,
  children,
  actions,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  body?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  testID?: string;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' }} onPress={onClose} accessibilityLabel="Close">
        <Pressable
          testID={testID}
          onPress={() => undefined}
          style={{
            backgroundColor: c.card,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 20,
            paddingBottom: (isWeb ? WEB_BOTTOM : Math.max(insets.bottom, 16)) + 8,
            gap: 12,
            maxWidth: 640,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.input, marginBottom: 4 }} />
          <T v="h2">{title}</T>
          {body ? (
            <T v="body" muted>
              {body}
            </T>
          ) : null}
          {children}
          {actions ? <View style={{ gap: 10, marginTop: 4 }}>{actions}</View> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function KeyValue({ label, value, strong, color, testID }: { label: string; value: string; strong?: boolean; color?: string; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 5, gap: 12 }}>
      <T v={strong ? 'bodyStrong' : 'body'} muted={!strong} color={color} style={{ flex: 1 }}>
        {label}
      </T>
      <T v={strong ? 'num' : 'body'} color={color} testID={testID} style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </T>
    </View>
  );
}
