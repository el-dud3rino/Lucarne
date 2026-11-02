import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderSync, Link2, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { timeAgo } from '../lib/time.js';
import { CopyButton, Linkify } from './NoticeBanner.js';
import type { SharedPhotoAlbum } from '../../shared/types.js';

const isBusy = (a: SharedPhotoAlbum) => ['queued', 'listing', 'downloading'].includes(a.progress.state);

/** Shared Google Photos albums: paste a link, Lucarne mirrors every photo and re-checks daily. */
export const SharedAlbumsSection: React.FC = () => {
  const queryClient = useQueryClient();
  const [link, setLink] = useState('');
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const { data: albums = [] } = useQuery({
    queryKey: ['photo-albums'],
    queryFn: () => apiFetch<SharedPhotoAlbum[]>('/api/photos/albums'),
    // Poll quickly while something is syncing so progress moves; slowly otherwise.
    refetchInterval: (q) => ((q.state.data ?? []).some(isBusy) ? 2000 : 60_000),
  });

  const onAlbums = (next: SharedPhotoAlbum[]) => {
    queryClient.setQueryData(['photo-albums'], next);
    queryClient.invalidateQueries({ queryKey: ['photos'] });
  };

  const addMutation = useMutation({
    mutationFn: (url: string) =>
      apiFetch<SharedPhotoAlbum[]>('/api/photos/albums', { method: 'POST', body: JSON.stringify({ url }) }),
    onSuccess: (next) => {
      setLink('');
      onAlbums(next);
    },
  });
  const syncMutation = useMutation({
    mutationFn: (id: string) => apiFetch<SharedPhotoAlbum[]>(`/api/photos/albums/${id}/sync`, { method: 'POST' }),
    onSuccess: onAlbums,
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => apiFetch<SharedPhotoAlbum[]>(`/api/photos/albums/${id}`, { method: 'DELETE' }),
    onSuccess: (next) => {
      setConfirmRemoveId(null);
      onAlbums(next);
    },
  });

  return (
    <div className="space-y-2.5 rounded-2xl border border-stone-200 bg-stone-50/60 p-3.5">
      <div className="flex items-center gap-2 font-bold text-sm text-slate-800">
        <FolderSync className="w-4 h-4 text-sky-600" />
        Shared albums (any size, updates daily)
      </div>
      <p className="text-xs text-stone-500">
        In Google Photos, open the album → Share → <b>Create link</b>, and paste it here. Lucarne downloads every
        photo (no 2,000 limit) and checks for new ones each day. Anyone with the link can view the album. This uses an
        unofficial method; if Google changes it, syncing pauses and your downloaded photos stay.
      </p>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (link.trim()) addMutation.mutate(link.trim());
        }}
      >
        <div className="relative flex-1">
          <Link2 className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="url"
            inputMode="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://photos.app.goo.gl/…"
            className="w-full h-10 min-h-[40px] pl-9 pr-3 rounded-xl bg-white border border-stone-200 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={!link.trim() || addMutation.isPending}
          className="h-10 min-h-[40px] min-w-[40px] px-4 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-bold text-xs flex items-center gap-1.5"
        >
          {addMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Add album
        </button>
      </form>

      {addMutation.isError && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700 font-semibold">
          <div className="flex-1 select-text break-words">
            <Linkify text={(addMutation.error as Error).message} />
          </div>
          <CopyButton text={(addMutation.error as Error).message} />
        </div>
      )}

      {albums.map((album) => {
        const busy = isBusy(album);
        const p = album.progress;
        const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
        const error = !busy && (p.state === 'error' ? p.message : album.syncError);
        return (
          <div key={album.id} className="rounded-xl bg-white border border-stone-200 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-sm text-slate-800 truncate">{album.title}</div>
                <div className="text-[11px] text-stone-500">
                  {album.photoCount.toLocaleString()} photos · synced {timeAgo(album.lastSyncedAt)}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  aria-label={`Sync ${album.title} now`}
                  disabled={busy}
                  onClick={() => syncMutation.mutate(album.id)}
                  className="h-10 min-h-[40px] min-w-[40px] px-3 rounded-xl bg-stone-100 hover:bg-stone-200 disabled:opacity-60 text-xs font-bold flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                  {busy ? 'Syncing' : 'Sync'}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${album.title}`}
                  onClick={() =>
                    confirmRemoveId === album.id ? removeMutation.mutate(album.id) : setConfirmRemoveId(album.id)
                  }
                  className={`h-10 min-h-[40px] min-w-[40px] px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 ${
                    confirmRemoveId === album.id
                      ? 'bg-rose-600 text-white'
                      : 'bg-white border border-rose-200 text-rose-700 hover:bg-rose-50'
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {confirmRemoveId === album.id ? 'Remove + delete photos?' : 'Remove'}
                </button>
              </div>
            </div>

            {busy && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-sky-700">
                  {p.state === 'queued' && 'Waiting to sync…'}
                  {p.state === 'listing' && `Reading album… ${p.total.toLocaleString()} found so far`}
                  {p.state === 'downloading' &&
                    (p.total === 0
                      ? 'Up to date'
                      : `Downloading ${p.done.toLocaleString()} of ${p.total.toLocaleString()} new photos`)}
                </div>
                {p.state === 'downloading' && p.total > 0 && (
                  <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
                    <div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1.5 text-[11px] text-rose-700 font-semibold">
                <div className="flex-1 select-text break-words">
                  <Linkify text={error} />
                </div>
                <CopyButton text={error} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
