import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { F } from '@/components/ui';
import { paper } from '@/constants/colors';
import { date, money } from '@/lib/format';
import type { QuoteDoc } from '@/lib/types';

/**
 * The customer's view of a quote, drawn on "paper" in both light and dark mode
 * so the operator sees exactly what the customer will get.
 */
const INK = paper.ink;
const MUTED = paper.muted;
const RULE = paper.rule;

export function QuoteDocView({ doc, testID }: { doc: QuoteDoc; testID?: string }) {
  const b = doc.business;
  return (
    <View testID={testID} style={s.paper}>
      {doc.sample ? (
        <View style={s.sample}>
          <Text style={s.sampleText}>SAMPLE QUOTE · NOT A REAL QUOTE</Text>
        </View>
      ) : null}
      <View style={s.top}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
          {b.logo ? <Image source={{ uri: b.logo }} style={s.logo} accessibilityIgnoresInvertColors /> : null}
          <View style={{ flex: 1 }}>
            <Text style={s.biz} numberOfLines={2}>
              {b.name || 'Your business name'}
            </Text>
            {b.phone || b.email ? (
              <Text style={s.small} numberOfLines={2}>
                {[b.phone, b.email].filter(Boolean).join('  ·  ')}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View style={s.bar} />
          <Text style={s.h1}>Quote</Text>
          <Text style={s.small}>{doc.reference}</Text>
        </View>
      </View>

      <View style={s.meta}>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>Prepared for</Text>
          <Text style={s.value}>{doc.customer.name || '\u2014'}</Text>
          {doc.customer.address ? <Text style={s.small}>{doc.customer.address}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.label}>Date</Text>
          <Text style={s.value}>{date(doc.issuedAt)}</Text>
          {doc.validUntil ? <Text style={s.small}>Valid until {date(doc.validUntil)}</Text> : null}
        </View>
      </View>

      <View style={s.thead}>
        <Text style={[s.label, { flex: 1 }]}>Service</Text>
        <Text style={s.label}>Amount</Text>
      </View>
      {doc.lines.map((l, i) => (
        <View key={`${l.name}-${i}`} style={s.tr}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.svc}>{l.name}</Text>
            {l.qty ? <Text style={s.small}>{l.qty}</Text> : null}
            {l.detail ? <Text style={s.small}>{l.detail}</Text> : null}
          </View>
          <Text style={[s.amt, l.included ? { color: paper.included } : null]}>{l.included ? 'Included' : money(l.amount)}</Text>
        </View>
      ))}
      {doc.excluded.length ? (
        <View style={s.excl}>
          <Text style={s.label}>Not included</Text>
          <Text style={[s.small, { color: INK, marginTop: 2 }]}>{doc.excluded.join(', ')}</Text>
        </View>
      ) : null}

      <View style={s.totals}>
        <Row label="Services" value={money(doc.subtotal)} />
        {doc.minimumAdjustment > 0 ? <Row label="Job minimum adjustment" value={money(doc.minimumAdjustment)} /> : null}
        {doc.discount ? <Row label={doc.discount.label} value={money(-doc.discount.amount)} /> : null}
        {doc.tax ? <Row label={doc.tax.label} value={money(doc.tax.amount)} /> : null}
        <View style={s.grand}>
          <Text style={s.grandText}>Total</Text>
          <Text style={s.grandText}>{money(doc.total)}</Text>
        </View>
        {doc.deposit ? (
          <>
            <Row label="Deposit due to book" value={money(doc.deposit.amount)} strong />
            <Row label="Balance on completion" value={money(doc.deposit.balance)} />
          </>
        ) : null}
      </View>

      {doc.notes ? (
        <View style={s.section}>
          <Text style={s.label}>Notes</Text>
          <Text style={s.body}>{doc.notes}</Text>
        </View>
      ) : null}
      {doc.terms ? (
        <View style={s.section}>
          <Text style={s.label}>Terms</Text>
          <Text style={[s.small, { marginTop: 3 }]}>{doc.terms}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: 10 }}>
      <Text style={[s.body, strong ? { fontFamily: F.semibold } : null, { flex: 1 }]}>{label}</Text>
      <Text style={[s.body, { fontVariant: ['tabular-nums'] }, strong ? { fontFamily: F.semibold } : null]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  paper: {
    backgroundColor: paper.sheet,
    borderRadius: 14,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: paper.edge,
    shadowColor: paper.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    overflow: 'hidden',
  },
  sample: { backgroundColor: paper.sampleBg, borderRadius: 8, paddingVertical: 6, alignItems: 'center', marginBottom: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: paper.sampleBorder },
  sampleText: { fontFamily: F.semibold, fontSize: 11, letterSpacing: 1.2, color: paper.sampleInk },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 14, borderBottomWidth: 3, borderBottomColor: INK, gap: 12 },
  logo: { width: 42, height: 42, borderRadius: 9 },
  biz: { fontFamily: F.display, fontSize: 20, color: INK },
  bar: { width: 28, height: 4, borderRadius: 2, backgroundColor: paper.accentBar, marginBottom: 4 },
  h1: { fontFamily: F.display, fontSize: 26, color: INK, lineHeight: 28 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, gap: 16 },
  label: { fontFamily: F.semibold, fontSize: 9.5, letterSpacing: 1.2, textTransform: 'uppercase', color: MUTED },
  value: { fontFamily: F.semibold, fontSize: 14, color: INK, marginTop: 2 },
  small: { fontFamily: F.body, fontSize: 12, color: MUTED, lineHeight: 16 },
  body: { fontFamily: F.body, fontSize: 13, color: INK, lineHeight: 18 },
  thead: { flexDirection: 'row', marginTop: 18, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: paper.ruleStrong },
  tr: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: RULE, alignItems: 'flex-start' },
  svc: { fontFamily: F.semibold, fontSize: 14, color: INK },
  amt: { fontFamily: F.semibold, fontSize: 14, color: INK, fontVariant: ['tabular-nums'] },
  excl: { marginTop: 12, padding: 10, backgroundColor: paper.wash, borderRadius: 8 },
  totals: { marginTop: 14, alignSelf: 'flex-end', width: '78%' },
  grand: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 2, borderTopColor: INK, marginTop: 6, paddingTop: 8, paddingBottom: 4 },
  grandText: { fontFamily: F.display, fontSize: 22, color: INK, fontVariant: ['tabular-nums'] },
  section: { marginTop: 16 },
});
