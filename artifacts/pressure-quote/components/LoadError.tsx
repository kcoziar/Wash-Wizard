import React, { useState } from 'react';
import { View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner, Button, T } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { SUPPORT_EMAIL } from '@/constants/legal';
import { emailSupport } from '@/lib/support';

/** Blocks the app while saved data cannot be opened, so nothing can overwrite it. */
export function LoadErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [mailFailed, setMailFailed] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24, paddingHorizontal: 24, gap: 14, justifyContent: 'center' }} testID="load-error">
      <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: c.uncertainSoft, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
        <Feather name="hard-drive" size={26} color={c.uncertain} />
      </View>
      <T v="h2" style={{ textAlign: 'center' }} accessibilityRole="header">
        Your jobs didn't open
      </T>
      <T v="body" muted style={{ textAlign: 'center' }}>
        {message} The app is paused so nothing can be written over them. Closing other apps or freeing up some storage often helps.
      </T>
      <Button title="Try again" icon="refresh-cw" onPress={onRetry} testID="load-error-retry" />
      <Button
        title="Contact support"
        icon="mail"
        variant="secondary"
        onPress={async () => {
          setMailFailed(false);
          if (!(await emailSupport({ subject: "My jobs didn't open" }))) setMailFailed(true);
        }}
        testID="load-error-support"
      />
      {mailFailed ? <Banner tone="warn" title="Mail isn't set up on this device" body={`Write to ${SUPPORT_EMAIL} from any email app.`} /> : null}
    </View>
  );
}
