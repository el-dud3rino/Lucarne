/**
 * Pure three-way merge between a Lucarne list and a Google Keep list note.
 *
 * Each linked item pair remembers what each side looked like after the last successful sync
 * (Keep text, Lucarne display text, checked). A field that changed on one side since then wins;
 * if both sides changed the same field, Keep wins (usually the more recent voice/phone edit).
 *
 * Keep and Lucarne text are tracked separately because Lucarne re-formats text it imports
 * (e.g. "2 Gallons milk" -> quantity "2 gallons" + "milk"); a single shared snapshot would
 * see that reformatting as a change on every cycle and never settle.
 *
 * Unlinked items are paired by normalized text before anything is created, so the first sync
 * and any interrupted sync heal themselves instead of producing duplicates.
 */

export interface LocalListItem {
  id: string;
  text: string;
  quantity: string;
  checked: boolean;
}

export interface KeepListItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface KeepItemLink {
  localId: string;
  keepId: string;
  lastKeepText: string;
  lastLocalText: string;
  lastChecked: boolean;
}

export type KeepOp =
  | { op: 'create'; tempId: string; text: string; checked: boolean }
  | { op: 'update'; keepId: string; text: string; checked: boolean }
  | { op: 'delete'; keepId: string };

/** `text` on local ops is Keep text; the applier parses it into text/quantity/category. */
export type LocalOp =
  | { op: 'create'; localId: string; text: string; checked: boolean }
  | { op: 'update'; localId: string; text: string | null; checked: boolean }
  | { op: 'delete'; localId: string };

export interface KeepSyncPlan {
  keepOps: KeepOp[];
  localOps: LocalOp[];
  /** Links after this sync. keepId may be a tempId ("tmp:...") until Keep creates the item. */
  links: KeepItemLink[];
}

export const TEMP_PREFIX = 'tmp:';

/** How a Lucarne item is written into Keep: "2 gallons milk". */
export function localDisplayText(item: Pick<LocalListItem, 'text' | 'quantity'>): string {
  const qty = (item.quantity || '').trim();
  const text = (item.text || '').trim();
  return qty ? `${qty} ${text}` : text;
}

export function normalizeForMatch(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface PlanOptions {
  newLocalId: () => string;
  /** Lucarne display text that results from importing a Keep string (parse then display). */
  importedDisplay?: (keepText: string) => string;
  /**
   * When an item disappears locally, always remove it from Keep, even if Keep edited it since.
   * Used for chores, where Lucarne decides what is due today.
   */
  localAuthoritativeDeletes?: boolean;
}

export function planKeepSync(
  localItems: LocalListItem[],
  keepItems: KeepListItem[],
  previousLinks: KeepItemLink[],
  options: PlanOptions
): KeepSyncPlan {
  const importedDisplay = options.importedDisplay ?? ((t: string) => t.trim());
  const localById = new Map(localItems.map((l) => [l.id, l]));
  const keepById = new Map(keepItems.map((k) => [k.id, { ...k, text: k.text.trim() }]));
  const keepOps: KeepOp[] = [];
  const localOps: LocalOp[] = [];
  const links: KeepItemLink[] = [];
  const linkedLocal = new Set<string>();
  const linkedKeep = new Set<string>();

  const createInKeep = (l: LocalListItem) => {
    const text = localDisplayText(l);
    const tempId = `${TEMP_PREFIX}${l.id}`;
    keepOps.push({ op: 'create', tempId, text, checked: l.checked });
    links.push({ localId: l.id, keepId: tempId, lastKeepText: text, lastLocalText: text, lastChecked: l.checked });
  };
  const createLocally = (k: KeepListItem) => {
    const localId = options.newLocalId();
    localOps.push({ op: 'create', localId, text: k.text, checked: k.checked });
    links.push({
      localId,
      keepId: k.id,
      lastKeepText: k.text,
      lastLocalText: importedDisplay(k.text),
      lastChecked: k.checked,
    });
  };

  // 1. Previously linked pairs
  for (const link of previousLinks) {
    if (link.keepId.startsWith(TEMP_PREFIX)) continue; // never resolved; re-pairing handles it
    const l = localById.get(link.localId);
    const k = keepById.get(link.keepId);
    if (l) linkedLocal.add(l.id);
    if (k) linkedKeep.add(k.id);
    if (!l && !k) continue;

    if (!l && k) {
      const keepEditedSince = k.text !== link.lastKeepText || k.checked !== link.lastChecked;
      if (keepEditedSince && !options.localAuthoritativeDeletes) createLocally(k);
      else keepOps.push({ op: 'delete', keepId: k.id });
      continue;
    }

    const lText = localDisplayText(l!);
    if (l && !k) {
      const localEditedSince = lText !== link.lastLocalText || l.checked !== link.lastChecked;
      if (localEditedSince) createInKeep(l);
      else localOps.push({ op: 'delete', localId: l.id });
      continue;
    }

    let keepText = k!.text;
    let localText = lText;
    let pushTextToLocal: string | null = null;
    if (k!.text !== link.lastKeepText) {
      localText = importedDisplay(k!.text);
      if (localText !== lText) pushTextToLocal = k!.text;
    } else if (lText !== link.lastLocalText) {
      keepText = lText;
    }

    const checked =
      k!.checked !== link.lastChecked
        ? k!.checked
        : l!.checked !== link.lastChecked
          ? l!.checked
          : link.lastChecked;

    if (k!.text !== keepText || k!.checked !== checked) {
      keepOps.push({ op: 'update', keepId: k!.id, text: keepText, checked });
    }
    if (pushTextToLocal !== null || l!.checked !== checked) {
      localOps.push({ op: 'update', localId: l!.id, text: pushTextToLocal, checked });
    }
    links.push({
      localId: l!.id,
      keepId: k!.id,
      lastKeepText: keepText,
      lastLocalText: localText,
      lastChecked: checked,
    });
  }

  // 2. Pair unlinked items by normalized text (first sync / interrupted sync recovery)
  const unlinkedLocalByText = new Map<string, LocalListItem[]>();
  for (const l of localItems) {
    if (linkedLocal.has(l.id)) continue;
    const key = normalizeForMatch(localDisplayText(l));
    const bucket = unlinkedLocalByText.get(key) ?? [];
    bucket.push(l);
    unlinkedLocalByText.set(key, bucket);
  }

  for (const k of keepById.values()) {
    if (linkedKeep.has(k.id)) continue;
    const bucket =
      unlinkedLocalByText.get(normalizeForMatch(k.text)) ??
      unlinkedLocalByText.get(normalizeForMatch(importedDisplay(k.text)));
    const l = bucket?.shift();
    if (!l) {
      createLocally(k);
      continue;
    }
    // No shared history: keep it on the list if either side still needs it.
    const checked = k.checked && l.checked;
    if (k.checked !== checked) keepOps.push({ op: 'update', keepId: k.id, text: k.text, checked });
    if (l.checked !== checked) localOps.push({ op: 'update', localId: l.id, text: null, checked });
    links.push({
      localId: l.id,
      keepId: k.id,
      lastKeepText: k.text,
      lastLocalText: localDisplayText(l),
      lastChecked: checked,
    });
  }

  // 3. Remaining local-only items go to Keep
  for (const bucket of unlinkedLocalByText.values()) {
    for (const l of bucket) createInKeep(l);
  }

  return { keepOps, localOps, links };
}
