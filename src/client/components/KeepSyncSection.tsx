import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ListChecks, Loader2, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { timeAgo } from '../lib/time.js';
import type { FamilyMember, TaskList } from '../../shared/types.js';

interface KeepStatusResponse {
  configured: boolean;
  email: string | null;
  state: 'idle' | 'syncing' | 'ok' | 'error';
  message: string;
  lastSyncAt: string | null;
  links: Array<{ listId: string; keepNoteId: string; keepNoteTitle: string }>;
  choreLinks: Array<{ memberId: string; keepNoteId: string; keepNoteTitle: string }>;
}

interface KeepNote {
  id: string;
  title: string;
  itemCount: number;
}

const CREATE_NEW = '__create__';

interface LinkRowProps {
  label: string;
  linked?: { keepNoteId: string; keepNoteTitle: string };
  notes: KeepNote[];
  notesRequested: boolean;
  disabled: boolean;
  createLabel?: string;
  onRequestNotes: () => void;
  onChange: (value: string) => void;
}

const LinkRow: React.FC<LinkRowProps> = ({
  label,
  linked,
  notes,
  notesRequested,
  disabled,
  createLabel,
  onRequestNotes,
  onChange,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 px-4 py-2.5">
    <div className="font-bold text-slate-700">{label}</div>
    {notesRequested ? (
      <select
        aria-label={`Keep list for ${label}`}
        value={linked?.keepNoteId ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 min-h-[40px] rounded-xl bg-stone-50 border border-stone-200 px-3 text-sm font-medium max-w-[60%]"
      >
        <option value="">Not synced with Keep</option>
        {createLabel && <option value={CREATE_NEW}>+ New Keep list "{createLabel}"</option>}
        {linked && !notes.some((n) => n.id === linked.keepNoteId) && (
          <option value={linked.keepNoteId}>{linked.keepNoteTitle || 'Linked Keep list'}</option>
        )}
        {notes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.title} ({n.itemCount})
          </option>
        ))}
      </select>
    ) : (
      <button
        type="button"
        onClick={onRequestNotes}
        className="h-10 min-h-[40px] px-3.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-sm font-semibold"
      >
        {linked ? `↔ ${linked.keepNoteTitle || 'Keep list'}` : 'Link a Keep list'}
      </button>
    )}
  </div>
);

/** Settings card for two-way Google Keep sync: shopping/other lists and per-person chore lists. */
export const KeepSyncSection: React.FC<{ members: FamilyMember[] }> = ({ members }) => {
  const queryClient = useQueryClient();
  const [notesRequested, setNotesRequested] = useState(false);

  const { data: status } = useQuery({
    queryKey: ['keep-status'],
    queryFn: () => apiFetch<KeepStatusResponse>('/api/keep/status'),
    refetchInterval: 15_000,
  });

  const { data: lists = [] } = useQuery({
    queryKey: ['lists'],
    queryFn: () => apiFetch<TaskList[]>('/api/lists'),
  });

  const notesQuery = useQuery({
    queryKey: ['keep-notes'],
    queryFn: () => apiFetch<{ notes: KeepNote[] }>('/api/keep/notes'),
    enabled: Boolean(status?.configured) && notesRequested,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const afterChange = (next: KeepStatusResponse) => {
    queryClient.setQueryData(['keep-status'], next);
    queryClient.invalidateQueries({ queryKey: ['lists'] });
    queryClient.invalidateQueries({ queryKey: ['chores'] });
  };

  const notes = notesQuery.data?.notes ?? [];
  const noteById = (id: string) => notes.find((n) => n.id === id);

  const listLinkMutation = useMutation({
    mutationFn: ({ listId, value }: { listId: string; value: string }) => {
      const note = noteById(value);
      return note
        ? apiFetch<KeepStatusResponse>(`/api/keep/links/${listId}`, {
            method: 'PUT',
            body: JSON.stringify({ keepNoteId: note.id, keepNoteTitle: note.title }),
          })
        : apiFetch<KeepStatusResponse>(`/api/keep/links/${listId}`, { method: 'DELETE' });
    },
    onSuccess: afterChange,
  });

  const choreLinkMutation = useMutation({
    mutationFn: ({ member, value }: { member: FamilyMember; value: string }) => {
      if (!value) {
        return apiFetch<KeepStatusResponse>(`/api/keep/chore-links/${member.id}`, { method: 'DELETE' });
      }
      const note = noteById(value);
      const body =
        value === CREATE_NEW
          ? { createTitle: `${member.name}'s Chores` }
          : { keepNoteId: value, keepNoteTitle: note?.title ?? '' };
      return apiFetch<KeepStatusResponse>(`/api/keep/chore-links/${member.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    },
    onSuccess: (next) => {
      afterChange(next);
      queryClient.invalidateQueries({ queryKey: ['keep-notes'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => apiFetch<KeepStatusResponse>('/api/keep/sync', { method: 'POST' }),
    onSuccess: afterChange,
  });

  const busy =
    listLinkMutation.isPending ||
    choreLinkMutation.isPending ||
    syncMutation.isPending ||
    status?.state === 'syncing';
  const anyLinks = (status?.links.length ?? 0) + (status?.choreLinks?.length ?? 0) > 0;
  const people = members.filter((m) => m.role !== 'family');
  const mutationError = (listLinkMutation.error || choreLinkMutation.error) as Error | null;

  return (
    <section className="bg-white rounded-3xl border border-stone-200 p-5 space-y-4 shadow-2xs">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
          <ListChecks className="w-5 h-5 text-amber-500" />
          Google Keep Lists
        </h3>
        {status?.configured && anyLinks && (
          <button
            type="button"
            onClick={() => syncMutation.mutate()}
            disabled={busy}
            className="h-10 min-h-[40px] min-w-[40px] px-3.5 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 disabled:opacity-60 text-xs font-bold flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
            Sync Now
          </button>
        )}
      </div>

      <p className="text-sm text-stone-500">
        Two-way sync with Google Keep, so items added with "Hey Google, add milk to my shopping
        list" show up here, and check-offs here show up in Keep. Uses an unofficial Keep connection:
        if Google changes something, sync pauses but everything keeps working on this screen.
      </p>

      {!status?.configured ? (
        <div className="rounded-2xl bg-stone-50 border border-stone-200 p-4 text-sm space-y-2">
          <div className="font-bold text-slate-700">Not linked yet. On the Lucarne computer, run:</div>
          <code className="block rounded-xl bg-slate-800 text-slate-100 px-3 py-2 text-xs">
            npm run keep:setup
            <br />
            npm run keep:login
          </code>
          <div className="text-stone-500">Then come back here to choose which Keep lists to sync.</div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-stone-500">
              Linked as <span className="font-bold text-slate-700">{status.email ?? 'Google account'}</span>
            </span>
            {status.state === 'error' ? (
              <span className="flex items-center gap-1.5 text-rose-600 font-semibold select-text">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Sync paused: {status.message}
              </span>
            ) : anyLinks ? (
              <span className="flex items-center gap-1.5 text-emerald-600 font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                Synced {timeAgo(status.lastSyncAt)}
              </span>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-stone-400">Lists</div>
            {lists.map((list) => (
              <LinkRow
                key={list.id}
                label={`${list.emoji} ${list.name}`}
                linked={status.links.find((l) => l.listId === list.id)}
                notes={notes}
                notesRequested={notesRequested}
                disabled={busy || notesQuery.isLoading}
                onRequestNotes={() => setNotesRequested(true)}
                onChange={(value) => listLinkMutation.mutate({ listId: list.id, value })}
              />
            ))}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-stone-400">
              Chores: one Keep list per person, showing today's chores
            </div>
            {people.map((member) => (
              <LinkRow
                key={member.id}
                label={member.name}
                linked={status.choreLinks?.find((l) => l.memberId === member.id)}
                notes={notes}
                notesRequested={notesRequested}
                disabled={busy || notesQuery.isLoading}
                createLabel={`${member.name}'s Chores`}
                onRequestNotes={() => setNotesRequested(true)}
                onChange={(value) => choreLinkMutation.mutate({ member, value })}
              />
            ))}
          </div>

          {notesRequested && notesQuery.isLoading && (
            <div className="flex items-center gap-2 text-sm text-stone-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your Keep lists…
            </div>
          )}
          {notesQuery.isError && (
            <div className="text-sm text-rose-600 select-text">{(notesQuery.error as Error).message}</div>
          )}
          {mutationError && <div className="text-sm text-rose-600 select-text">{mutationError.message}</div>}
        </>
      )}
    </section>
  );
};
