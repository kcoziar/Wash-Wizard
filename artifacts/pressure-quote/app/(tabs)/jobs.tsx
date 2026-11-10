import React, { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { JobRow } from '@/components/job';
import { Button, Chip, EmptyState, Field, Header, isWeb } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useStore } from '@/lib/store';
import type { Job } from '@/lib/types';

type Filter = 'all' | 'drafts' | 'open' | 'won' | 'lost';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'drafts', label: 'Drafts' },
  { value: 'open', label: 'Waiting' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

function matches(job: Job, f: Filter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'drafts':
      return job.status === 'draft';
    case 'open':
      return job.status === 'quoted' || job.status === 'sent';
    case 'won':
      return job.status === 'accepted' || job.status === 'completed';
    case 'lost':
      return job.status === 'declined';
  }
}

export default function JobsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const store = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.jobs.filter((j) => {
      if (!matches(j, filter)) return false;
      if (!q) return true;
      const ref = j.revisions.map((r) => r.reference).join(' ');
      return [j.label, j.draft.customer.name, j.draft.customer.address, j.draft.customer.phone, ref].join(' ').toLowerCase().includes(q);
    });
  }, [store.jobs, filter, query]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Header title="Jobs" large back={false} />
      <View style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 6 }}>
        <Field value={query} onChangeText={setQuery} placeholder="Search customer, address or quote number" testID="jobs-search" autoCapitalize="none" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {FILTERS.map((f) => (
            <Chip key={f.value} small label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} testID={`jobs-filter-${f.value}`} />
          ))}
        </View>
      </View>
      <FlatList
        data={list}
        keyExtractor={(j) => j.id}
        scrollEnabled={list.length > 0}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: (isWeb ? 84 : insets.bottom + 70) + 24, gap: 10, flexGrow: 1 }}
        renderItem={({ item }) => <JobRow job={item} onPress={() => router.push({ pathname: '/job/[id]', params: { id: item.id } })} />}
        ListEmptyComponent={
          store.jobs.length === 0 ? (
            <EmptyState icon="inbox" title="No jobs yet" body="Every quote you start is saved here as you go, even before you send it." action={<Button title="Start a quote" icon="plus" onPress={() => router.push('/')} />} />
          ) : (
            <EmptyState icon="search" title="Nothing matches" body="Try a different name, or switch the filter back to All." />
          )
        }
      />
    </View>
  );
}
