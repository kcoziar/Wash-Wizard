import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { Banner, Button, Card, Field, Screen, SectionLabel, T } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { pickLogo } from '@/lib/output';
import { useStore } from '@/lib/store';
import type { Settings } from '@/lib/types';

export default function BusinessScreen() {
  const c = useColors();
  const store = useStore();
  const b = store.settings.business;
  const [logoError, setLogoError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const set = (patch: Partial<Settings['business']>) => store.updateSettings((s) => ({ ...s, business: { ...s.business, ...patch } }));

  const chooseLogo = async () => {
    setLogoError(null);
    setPicking(true);
    const res = await pickLogo();
    setPicking(false);
    if (res.ok) set({ logo: res.dataUri });
    else if (!res.cancelled) setLogoError(res.error ?? 'That image could not be used. Try a PNG or JPG.');
  };

  return (
    <Screen title="Business details" subtitle="Shown at the top of every quote">
      <SectionLabel>Preview</SectionLabel>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }} testID="business-preview">
        {b.logo ? (
          <Image source={{ uri: b.logo }} style={{ width: 56, height: 56, borderRadius: 10 }} resizeMode="contain" accessibilityLabel="Your logo" />
        ) : (
          <View style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }}>
            <T v="h2" muted>
              {(b.name.trim()[0] ?? '?').toUpperCase()}
            </T>
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <T v="h3" numberOfLines={1}>
            {b.name.trim() || 'Your business name'}
          </T>
          <T v="small" muted numberOfLines={2}>
            {[b.phone, b.email].filter((x) => x.trim()).join(' · ') || 'Phone and email'}
          </T>
        </View>
      </Card>

      <Card style={{ gap: 12 }}>
        <Field label="Business name" value={b.name} onChangeText={(t) => set({ name: t })} placeholder="e.g. Clearline Exterior Cleaning" autoCapitalize="words" maxLength={80} testID="business-name" textContentType="organizationName" />
        <Field label="Phone" value={b.phone} onChangeText={(t) => set({ phone: t })} keyboardType="phone-pad" inputMode="tel" maxLength={40} testID="business-phone" textContentType="telephoneNumber" />
        <Field label="Email" value={b.email} onChangeText={(t) => set({ email: t })} keyboardType="email-address" inputMode="email" autoCapitalize="none" maxLength={120} testID="business-email" textContentType="emailAddress" />
      </Card>

      <SectionLabel>Logo</SectionLabel>
      <Card style={{ gap: 10 }}>
        <T v="small" muted>
          A square or wide logo works best. It is resized and stored on this iPhone.
        </T>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button size="md" variant="secondary" icon="image" title={b.logo ? 'Replace logo' : 'Choose logo'} onPress={chooseLogo} loading={picking} flex testID="business-logo" />
          {b.logo ? <Button size="md" variant="ghost" icon="trash-2" title="Remove" onPress={() => set({ logo: null })} testID="business-logo-remove" /> : null}
        </View>
        {logoError ? <Banner tone="warn" title={logoError} /> : null}
      </Card>
    </Screen>
  );
}
