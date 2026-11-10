import React from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Card, Screen, T, TextLink } from '@/components/ui';
import { APPLE_EULA_URL, LEGAL_UPDATED, PRIVACY, TERMS } from '@/constants/legal';

export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const isTerms = doc === 'terms';
  const sections = isTerms ? TERMS : PRIVACY;

  return (
    <Screen title={isTerms ? 'Terms of use' : 'Privacy policy'} subtitle={`Updated ${LEGAL_UPDATED}`}>
      {sections.map((s) => (
        <View key={s.title} style={{ gap: 6 }}>
          <T v="h3">{s.title}</T>
          <T v="body" muted>
            {s.body}
          </T>
        </View>
      ))}
      {isTerms ? (
        <Card tone="alt" style={{ gap: 8 }}>
          <T v="small" muted>
            Apple's Standard End User License Agreement applies to this app.
          </T>
          <TextLink title="Read Apple's license agreement" icon="external-link" onPress={() => Linking.openURL(APPLE_EULA_URL).catch(() => undefined)} testID="legal-eula" />
        </Card>
      ) : null}
    </Screen>
  );
}
