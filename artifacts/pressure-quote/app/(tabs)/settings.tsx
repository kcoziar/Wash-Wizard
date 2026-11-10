import React, { useState } from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Banner, Button, Card, Divider, Row, Screen, SectionLabel, T } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { APP_NAME, COMPANY } from '@/constants/legal';
import { RATED_KINDS } from '@/lib/defaults';
import { date, shortDate } from '@/lib/format';
import { useSubscription } from '@/lib/revenuecat';
import { useStore } from '@/lib/store';
import { FREE_QUOTES } from '@/lib/types';

export default function SettingsScreen() {
  const c = useColors();
  const store = useStore();
  const sub = useSubscription();
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'info' | 'danger'; text: string } | null>(null);
  const s = store.settings;
  const remaining = Math.max(0, FREE_QUOTES - store.freeUsed);
  const ratesSet = RATED_KINDS.filter((k) => s.rates[k].rate.trim() !== '').length;

  const restore = async () => {
    setRestoring(true);
    setNotice(null);
    const res = await sub.restore();
    setRestoring(false);
    setNotice(
      res.kind === 'restored'
        ? { tone: 'success', text: 'Pro restored. Unlimited quotes are on.' }
        : res.kind === 'nothing'
          ? { tone: 'info', text: 'No active purchase was found for this Apple ID.' }
          : { tone: 'danger', text: res.message },
    );
  };

  const statusText = (() => {
    switch (sub.status) {
      case 'active':
        return sub.expiresAt ? `${sub.willRenew ? 'Renews' : 'Ends'} ${date(sub.expiresAt)}` : 'Active';
      case 'grace':
        return 'Payment issue. Pro stays on while the App Store retries.';
      case 'cached':
        return 'Verified earlier on this iPhone';
      case 'pending':
        return 'Purchase waiting for approval';
      case 'unreachable':
        return "Couldn't reach the App Store";
      case 'unavailable':
        return 'Purchases are not available in this build';
      case 'checking':
        return 'Checking...';
      default:
        return `${remaining} of ${FREE_QUOTES} free quotes left`;
    }
  })();

  return (
    <Screen title="Settings" large back={false} tab>
      <Card style={{ gap: 12 }} tone={sub.isPro ? 'confirm' : undefined} testID="settings-plan">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T v="h3">{sub.isPro ? 'Pro' : 'Free'}</T>
            <T v="small" muted>
              {statusText}
            </T>
          </View>
          {sub.isPro ? (
            <Button size="sm" variant="outline" title="Manage" onPress={() => sub.openManage()} testID="settings-manage" />
          ) : sub.status !== 'unavailable' ? (
            <Button size="sm" title="See Pro" icon="star" onPress={() => router.push('/paywall')} testID="settings-see-pro" />
          ) : null}
        </View>
        {sub.status === 'unreachable' ? <Button size="sm" variant="outline" title="Try again" onPress={() => sub.refresh()} /> : null}
      </Card>
      {notice ? <Banner tone={notice.tone} title={notice.text} /> : null}

      <SectionLabel>Your business</SectionLabel>
      <Card style={{ paddingVertical: 2 }}>
        <Row icon="briefcase" title="Business details" subtitle="Name, phone, email and logo on every quote" value={s.business.name || 'Not set'} onPress={() => router.push('/settings/business')} testID="settings-business" />
        <Divider inset={44} />
        <Row icon="dollar-sign" title="Rates & quote defaults" subtitle="Rates, minimum, trip, tax, deposit, terms" value={ratesSet ? `${ratesSet} of 4 rates` : 'Not set'} onPress={() => router.push('/settings/rates')} testID="settings-rates" />
        <Divider inset={44} />
        <Row icon="clock" title="Time, costs & target pay" subtitle="Used for the private worth-it check" onPress={() => router.push('/settings/costs')} testID="settings-costs" />
      </Card>

      <SectionLabel>Data</SectionLabel>
      <Card style={{ paddingVertical: 2 }}>
        <Row icon="hard-drive" title="Backup & data" subtitle="Export, import, delete" value={store.meta.lastBackupAt ? `Last ${shortDate(store.meta.lastBackupAt)}` : 'Never backed up'} onPress={() => router.push('/settings/backup')} testID="settings-backup" />
      </Card>

      <SectionLabel>Help</SectionLabel>
      <Card style={{ paddingVertical: 2 }}>
        <Row icon="life-buoy" title="Support" subtitle="Questions, problems, ideas" onPress={() => router.push('/settings/support')} testID="settings-support" />
        <Divider inset={44} />
        <Row icon="rotate-ccw" title={restoring ? 'Restoring...' : 'Restore purchases'} onPress={restore} chevron={false} testID="settings-restore" />
        <Divider inset={44} />
        <Row icon="credit-card" title="Manage subscription" onPress={() => sub.openManage()} chevron={false} testID="settings-manage-row" />
      </Card>

      <SectionLabel>Legal</SectionLabel>
      <Card style={{ paddingVertical: 2 }}>
        <Row icon="shield" title="Privacy policy" onPress={() => router.push({ pathname: '/settings/legal', params: { doc: 'privacy' } })} testID="settings-privacy" />
        <Divider inset={44} />
        <Row icon="file-text" title="Terms of use" onPress={() => router.push({ pathname: '/settings/legal', params: { doc: 'terms' } })} testID="settings-terms" />
      </Card>

      <View style={{ alignItems: 'center', paddingTop: 8, gap: 2 }}>
        <T v="smallStrong" muted>
          {APP_NAME}
        </T>
        <T v="small" color={c.faint}>
          Version {Constants.expoConfig?.version ?? '1.0.0'} · {COMPANY}
        </T>
        {sub.isTestStore ? (
          <T v="small" color={c.faint}>
            Test store: purchases are simulated
          </T>
        ) : null}
      </View>
    </Screen>
  );
}
