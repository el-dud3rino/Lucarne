import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, History, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { NoticeBanner } from './NoticeBanner.js';

interface BackupInfo {
  name: string;
  sizeBytes: number;
  createdAt: string;
  preRestore: boolean;
}

/** Settings: automatic daily backups (newest 14 kept), Backup now, and one-tap restore with confirmation. */
export const BackupsSection: React.FC<{ lastBackupAt: string | null }> = ({ lastBackupAt }) => {
  const queryClient = useQueryClient();
  const { data: backups = [] } = useQuery({ queryKey: ['backups'], queryFn: () => apiFetch<BackupInfo[]>('/api/settings/backups') });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const backupNow = useMutation({
    mutationFn: () => apiFetch('/api/settings/backup', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setMsg({ tone: 'success', text: 'Backup saved.' });
    },
    onError: (e) => setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }),
  });
  const restore = useMutation({
    mutationFn: (name: string) =>
      apiFetch<{ restoredFrom: string; safetyBackup: string }>(`/api/settings/backups/${encodeURIComponent(name)}/restore`, { method: 'POST' }),
    onSuccess: (r) => {
      setConfirming(null);
      queryClient.invalidateQueries();
      setMsg({ tone: 'success', text: `Restored. Your data from just before the restore was saved as ${r.safetyBackup}, so this can be undone.` });
    },
    onError: (e) => {
      setConfirming(null);
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    },
  });

  return (
    <div className="pt-2 border-t border-stone-100 space-y-3" data-testid="backups">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-stone-500">
          <div className="font-bold text-slate-700 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-emerald-600" />
            Backups (automatic, daily — the last 14 are kept)
          </div>
          <div>{lastBackupAt ? `Last backup: ${new Date(lastBackupAt).toLocaleString()}` : 'First backup runs a minute after start-up'}</div>
        </div>
        <button
          type="button"
          onClick={() => backupNow.mutate()}
          disabled={backupNow.isPending}
          className="px-4 h-10 min-h-[40px] min-w-[40px] rounded-xl bg-stone-100 hover:bg-stone-200 text-slate-800 font-bold text-xs shrink-0"
        >
          Backup Now
        </button>
      </div>
      {msg && <NoticeBanner tone={msg.tone} text={msg.text} onDismiss={() => setMsg(null)} />}
      {backups.length > 0 && (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {backups.map((b) => (
            <div key={b.name} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-stone-50 text-xs">
              <History className="w-4 h-4 text-stone-400 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="font-bold text-slate-700">{new Date(b.createdAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                <span className="text-stone-400"> · {(b.sizeBytes / 1024 / 1024).toFixed(1)} MB{b.preRestore ? ' · saved before a restore' : ''}</span>
              </span>
              {confirming === b.name ? (
                <>
                  <span className="font-bold text-rose-700 hidden sm:inline">Replace everything?</span>
                  <button
                    type="button"
                    onClick={() => restore.mutate(b.name)}
                    disabled={restore.isPending}
                    className="h-10 min-h-[40px] px-3 rounded-xl bg-rose-600 text-white font-bold flex items-center gap-1"
                  >
                    {restore.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Yes, restore
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} className="h-10 min-h-[40px] px-3 rounded-xl bg-stone-200 font-bold">
                    No
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirming(b.name)} className="h-10 min-h-[40px] px-3 rounded-xl bg-white border border-stone-200 font-bold text-slate-700">
                  Restore…
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-stone-400">
        Backups live in the <code>data/backups</code> folder next to the database. Copy that folder somewhere else (USB stick, NAS) now and then for an off-device copy.
      </p>
    </div>
  );
};
