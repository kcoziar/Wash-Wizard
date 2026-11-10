import React, { useState } from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Banner, Button, Card, Screen, SectionLabel, Sheet, T, ToggleRow, haptic } from '@/components/ui';
import { date, shortDate } from '@/lib/format';
import { exportBackupFile, pickBackupText } from '@/lib/output';
import { markBackup, quotesCreated, settingsUntouched } from '@/lib/reminders';
import { buildBackup, checkBackup, type BackupCheck } from '@/lib/storage';
import { useStore } from '@/lib/store';

type Ready = Extract<BackupCheck, { ok: true }>;

export default function BackupScreen() {
  const store = useStore();
  const [busy, setBusy] = useState<'export' | 'import' | 'delete' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'info' | 'warn' | 'danger'; title: string; body?: string } | null>(null);
  const [pending, setPending] = useState<Ready | null>(null);
  const [useSettings, setUseSettings] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // A backup only counts once the operator says the file was saved somewhere.
  const [askSaved, setAskSaved] = useState(false);
  const realJobs = store.jobs.filter((j) => !j.sample);

  const answerSaved = (saved: boolean) => {
    setAskSaved(false);
    store.updateMeta((m) => markBackup(m, quotesCreated(store.jobs), Date.now(), saved));
    if (saved) {
      haptic('success');
      setNotice({ tone: 'success', title: 'Backup saved', body: 'Make a new one now and then, especially before you change phones.' });
    } else setNotice({ tone: 'info', title: 'Not backed up yet', body: 'Export again when you can save the file to Files or iCloud Drive.' });
  };

  const doExport = async () => {
    setBusy('export');
    setNotice(null);
    await store.flush();
    const json = buildBackup(store.settings, realJobs, Constants.expoConfig?.version ?? '1.0.0');
    const stamp = new Date().toISOString().slice(0, 10);
    const res = await exportBackupFile(json, `pressure-quote-backup-${stamp}.json`);
    setBusy(null);
    if (res === 'failed') {
      setNotice({ tone: 'danger', title: 'The backup file could not be made', body: 'Nothing was changed. Try again, or free up some storage.' });
      return;
    }
    setAskSaved(true);
  };

  const doPick = async () => {
    setBusy('import');
    setNotice(null);
    const file = await pickBackupText();
    setBusy(null);
    if (!file.ok) {
      if (!file.cancelled) setNotice({ tone: 'danger', title: file.error ?? 'That file could not be opened.' });
      return;
    }
    const check = checkBackup(file.text, new Set(store.jobs.map((j) => j.id)));
    if (!check.ok) {
      setNotice({ tone: 'danger', title: check.error });
      return;
    }
    // On a new or reset iPhone, bring the rates, business details and logo back too.
    setUseSettings(!!check.settings && settingsUntouched(store.settings));
    setPending(check);
  };

  const doImport = async () => {
    if (!pending) return;
    setBusy('import');
    const p = pending;
    setPending(null);
    try {
      const applySettings = useSettings && !!p.settings;
      const res = await store.addImported(p.jobs, applySettings ? p.settings : null);
      if (res.notSaved) {
        setNotice({
          tone: 'warn',
          title: `${res.saved} of ${p.jobs.length} jobs added`,
          body: `The rest could not be saved. Free up some storage and import the same file again; jobs already added are skipped.${applySettings ? ' Settings were not changed.' : ''}`,
        });
        return;
      }
      haptic('success');
      setNotice({
        tone: 'success',
        title: `Added ${p.jobs.length} ${p.jobs.length === 1 ? 'job' : 'jobs'}${applySettings ? ' and settings' : ''}`,
        body: [p.duplicates ? `${p.duplicates} already here, left as they were.` : null, p.skipped ? `${p.skipped} damaged ${p.skipped === 1 ? 'record was' : 'records were'} skipped.` : null].filter(Boolean).join(' ') || undefined,
      });
    } catch {
      setNotice({ tone: 'danger', title: 'The import did not finish', body: 'Try again. Jobs already on this iPhone were not changed.' });
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async () => {
    setConfirmDelete(false);
    setBusy('delete');
    try {
      await store.deleteAll();
      haptic('success');
      router.replace('/');
    } catch {
      setNotice({ tone: 'danger', title: 'Deleting did not finish', body: 'Try again.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen title="Backup & data" subtitle="Everything is stored on this iPhone">
      {notice ? <Banner tone={notice.tone} title={notice.title} body={notice.body} testID="backup-notice" /> : null}

      <SectionLabel>Back up</SectionLabel>
      <Card style={{ gap: 10 }}>
        <T v="body">
          Save a file with your {realJobs.length} {realJobs.length === 1 ? 'job' : 'jobs'}, quotes and settings. Keep it in Files or iCloud Drive in case you lose or replace this iPhone.
        </T>
        <T v="small" muted>
          {store.meta.lastBackupAt ? `Last exported ${shortDate(store.meta.lastBackupAt)}.` : 'Not backed up yet.'} The file includes customer details and your private costs, so keep it somewhere safe.
        </T>
        <Button title="Export backup" icon="download" onPress={doExport} loading={busy === 'export'} testID="backup-export" />
      </Card>

      <SectionLabel>Restore</SectionLabel>
      <Card style={{ gap: 10 }}>
        <T v="body">Add jobs from a backup file. Nothing already on this iPhone is overwritten.</T>
        <T v="small" muted>
          Purchases and free-quote counts are never part of a backup. Use Restore purchases for Pro.
        </T>
        <Button title="Choose backup file" variant="secondary" icon="upload" onPress={doPick} loading={busy === 'import'} testID="backup-import" />
      </Card>

      <SectionLabel>Delete</SectionLabel>
      <Card style={{ gap: 10 }}>
        <T v="body">Remove all jobs, quotes, settings and your logo from this iPhone.</T>
        <Button title="Delete all data" variant="danger" icon="trash-2" onPress={() => setConfirmDelete(true)} loading={busy === 'delete'} testID="backup-delete" />
      </Card>

      <Sheet
        visible={!!pending}
        onClose={() => setPending(null)}
        title={pending ? `Add ${pending.jobs.length} ${pending.jobs.length === 1 ? 'job' : 'jobs'}?` : ''}
        body={
          pending
            ? [`From a backup made ${date(pending.exportedAt)}.`, pending.duplicates ? `${pending.duplicates} already here will be left as they are.` : null, pending.skipped ? `${pending.skipped} damaged ${pending.skipped === 1 ? 'record' : 'records'} will be skipped.` : null]
                .filter(Boolean)
                .join(' ')
            : ''
        }
        actions={
          <>
            {pending?.settings ? (
              <View style={{ marginBottom: 4 }}>
                <ToggleRow title="Also use the backup's settings" subtitle="Rates, business details and defaults replace the current ones" value={useSettings} onChange={setUseSettings} testID="backup-use-settings" />
              </View>
            ) : null}
            <Button
              title={(() => {
                const n = pending?.jobs.length ?? 0;
                const jobs = `${n} ${n === 1 ? 'job' : 'jobs'}`;
                if (n === 0) return useSettings ? 'Use the settings only' : 'Nothing new to add';
                return useSettings ? `Add ${jobs} and settings` : `Add ${jobs}`;
              })()}
              onPress={pending && pending.jobs.length === 0 && !useSettings ? () => setPending(null) : doImport}
              testID="backup-import-confirm"
            />
            <Button variant="ghost" title="Cancel" onPress={() => setPending(null)} />
          </>
        }
      />

      <Sheet
        visible={askSaved}
        onClose={() => setAskSaved(false)}
        title="Did you save the file?"
        body="Only a file kept in Files, iCloud Drive or another safe place protects your jobs if this iPhone is lost."
        actions={
          <>
            <Button title="Yes, it's saved" onPress={() => answerSaved(true)} testID="backup-saved-yes" />
            <Button variant="ghost" title="Not yet" onPress={() => answerSaved(false)} testID="backup-saved-no" />
          </>
        }
      />

      <Sheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete everything on this iPhone?"
        body="All jobs, quotes, settings and your logo are removed. This can't be undone, so export a backup first if you might need them. Your subscription isn't affected, and the number of free quotes already used is kept."
        actions={
          <>
            <Button variant="danger" title="Delete everything" onPress={doDelete} testID="backup-delete-confirm" />
            <Button variant="ghost" title="Keep my data" onPress={() => setConfirmDelete(false)} />
          </>
        }
      />
    </Screen>
  );
}
