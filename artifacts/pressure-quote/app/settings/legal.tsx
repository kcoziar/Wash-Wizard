import React from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Card, Screen, T, TextLink } from '@/components/ui';
import { APPLE_EULA_URL, LEGAL_UPDATED, PRIVACY, PRIVACY_URL, TERMS, TERMS_URL, isPlaceholderUrl } from '@/constants/legal';

export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const isTerms = doc === 'terms';
  const sections = isTerms ? TERMS : PRIVACY;
  const hosted = isTerms ? TERMS_URL : PRIVACY_URL;

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
      {!isPlaceholderUrl(hosted) ? (
        <TextLink title="Read online" icon="external-link" onPress={() => Linking.openURL(hosted).catch(() => undefined)} testID="legal-online" />
      ) : null}
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
