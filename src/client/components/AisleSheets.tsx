import React, { useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { GROCERY_CATEGORIES, type GroceryCategory } from '../../shared/types.js';

export const AISLE_ICONS: Record<GroceryCategory, string> = {
  Produce: '🥬',
  'Dairy & Eggs': '🥛',
  'Meat & Seafood': '🥩',
  Bakery: '🥖',
  Frozen: '🧊',
  Pantry: '🫙',
  'Snacks & Drinks': '🥤',
  Household: '🧻',
  Other: '📌',
};

const Sheet: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }> = ({
  title,
  onClose,
  children,
  footer,
}) => (
  <div className="fixed inset-0 z-[70] bg-slate-900/40 flex items-end md:items-center justify-center p-0 md:p-6" onClick={onClose}>
    <div
      role="dialog"
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
      className="bg-white w-full md:max-w-md rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col max-h-[85vh]"
    >
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <div className="font-extrabold text-slate-800">{title}</div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl hover:bg-stone-100 flex items-center justify-center"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="px-4 pb-4 overflow-y-auto">{children}</div>
      {footer && <div className="border-t border-stone-200 p-4 flex justify-end gap-2">{footer}</div>}
    </div>
  </div>
);

/** Pick a different aisle for one item; the choice is remembered for next time. */
export const AislePickerSheet: React.FC<{
  itemText: string;
  current: GroceryCategory;
  onPick: (category: GroceryCategory) => void;
  onClose: () => void;
}> = ({ itemText, current, onPick, onClose }) => (
  <Sheet title={`Move "${itemText}" to…`} onClose={onClose}>
    <div className="grid grid-cols-2 gap-2">
      {GROCERY_CATEGORIES.map((cat) => (
        <button
          key={cat}
          type="button"
          onClick={() => onPick(cat)}
          aria-pressed={cat === current}
          className={`h-12 min-h-[40px] px-3 rounded-xl border text-sm font-bold flex items-center gap-2 text-left transition active:scale-[0.98] ${
            cat === current ? 'bg-sky-50 border-sky-300 text-sky-800' : 'bg-white border-stone-200 hover:bg-stone-50 text-slate-700'
          }`}
        >
          <span aria-hidden>{AISLE_ICONS[cat]}</span>
          {cat}
        </button>
      ))}
    </div>
    <p className="text-xs text-stone-500 mt-3">
      Lucarne will remember this, so "{itemText}" goes to the same aisle next time, whether it's added here, by
      voice through Google Keep, or from a recipe.
    </p>
  </Sheet>
);

/** Arrange aisles in the order you walk your store. */
export const StoreOrderSheet: React.FC<{
  order: GroceryCategory[];
  saving?: boolean;
  onSave: (order: GroceryCategory[]) => void;
  onClose: () => void;
}> = ({ order, saving, onSave, onClose }) => {
  const [draft, setDraft] = useState<GroceryCategory[]>(order);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.length) return;
    const next = [...draft];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  };
  return (
    <Sheet
      title="Store order"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={() => setDraft([...GROCERY_CATEGORIES])}
            className="h-11 min-h-[40px] px-4 rounded-xl bg-stone-100 hover:bg-stone-200 font-bold text-sm mr-auto"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-11 min-h-[40px] px-4 rounded-xl bg-stone-100 hover:bg-stone-200 font-bold text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave(draft)}
            className="h-11 min-h-[40px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-sm"
          >
            {saving ? 'Saving…' : 'Save order'}
          </button>
        </>
      }
    >
      <p className="text-xs text-stone-500 mb-3">
        Put the aisles in the order you walk your store. Grocery lists are grouped in this order.
      </p>
      <ol className="space-y-1.5">
        {draft.map((cat, i) => (
          <li key={cat} className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 pl-3 pr-1.5 py-1">
            <span className="w-6 text-xs font-extrabold text-stone-400">{i + 1}</span>
            <span aria-hidden>{AISLE_ICONS[cat]}</span>
            <span className="flex-1 font-bold text-sm text-slate-700">{cat}</span>
            <button
              type="button"
              aria-label={`Move ${cat} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
              className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-lg hover:bg-white disabled:opacity-30 flex items-center justify-center"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label={`Move ${cat} down`}
              disabled={i === draft.length - 1}
              onClick={() => move(i, 1)}
              className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-lg hover:bg-white disabled:opacity-30 flex items-center justify-center"
            >
              <ArrowDown className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ol>
    </Sheet>
  );
};
