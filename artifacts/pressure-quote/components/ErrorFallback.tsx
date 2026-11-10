import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { reloadAppAsync } from 'expo';
import { useColors } from '@/hooks/useColors';
import { SUPPORT_EMAIL } from '@/constants/legal';
import { emailSupport } from '@/lib/support';

export type ErrorFallbackProps = {
  error: Error;
  resetError: () => void;
};

/**
 * Shown when a screen fails to draw. Jobs are saved as the operator works, so the message leads
 * with that. Built from plain components so it cannot fail the same way the screen did.
 */
export function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [tries, setTries] = useState(0);
  const [mailFailed, setMailFailed] = useState(false);

  const tryAgain = async () => {
    // First try redraws the screen; if it fails again, restart the app.
    if (tries === 0) {
      setTries(1);
      resetError();
      return;
    }
    try {
      await reloadAppAsync();
    } catch {
      resetError();
    }
  };

  const support = async () => {
    setMailFailed(false);
    const detail = `${error.name}: ${String(error.message ?? '').slice(0, 300)}`;
    const ok = await emailSupport({ subject: 'The app hit a problem', lines: [`Error: ${detail}`] });
    if (!ok) setMailFailed(true);
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.icon, { backgroundColor: c.confirmSoft }]}>
          <Feather name="shield" size={26} color={c.confirm} />
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>
          Your data is safe
        </Text>
        <Text style={[styles.message, { color: c.mutedForeground }]}>
          This screen hit a problem and stopped. Your jobs, quotes and settings are saved on this iPhone and were not changed.
        </Text>

        <Pressable
          testID="error-try-again"
          accessibilityRole="button"
          onPress={tryAgain}
          style={({ pressed }) => [styles.button, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={[styles.buttonText, { color: c.primaryForeground }]}>{tries === 0 ? 'Try again' : 'Restart the app'}</Text>
        </Pressable>
        <Pressable
          testID="error-support"
          accessibilityRole="button"
          onPress={support}
          style={({ pressed }) => [styles.button, { backgroundColor: c.secondary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={[styles.buttonText, { color: c.secondaryForeground }]}>Tell support what happened</Text>
        </Pressable>
        {mailFailed ? (
          <Text selectable style={[styles.message, { color: c.mutedForeground }]}>
            Mail isn't set up on this device. Write to {SUPPORT_EMAIL} from any email app.
          </Text>
        ) : null}

        {__DEV__ ? (
          <Text selectable style={[styles.dev, { color: c.mutedForeground, backgroundColor: c.card, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) }]}>
            {`${error.message}\n\n${error.stack ?? ''}`.slice(0, 2000)}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', paddingHorizontal: 24 },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 14, maxWidth: 520, width: '100%', alignSelf: 'center' },
  icon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { fontSize: 26, fontWeight: '700', textAlign: 'center', lineHeight: 32 },
  message: { fontSize: 16, textAlign: 'center', lineHeight: 23 },
  button: { minHeight: 52, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  dev: { fontSize: 11, lineHeight: 15, padding: 12, borderRadius: 10, alignSelf: 'stretch', marginTop: 12 },
});
