import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Check, ListOrdered, Plus, ShoppingCart, Trash2, Sparkles, Settings2, X } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { classifyGroceryItem, orderAisles } from '../../shared/groceryClassifier.js';
import { AISLE_ICONS, AislePickerSheet, StoreOrderSheet } from '../components/AisleSheets.js';
import { parseItemInput } from '../../shared/ingredientAggregator.js';
import {
  type AppSettings,
  type GroceryCategory,
  type ListItem,
  type TaskList,
} from '../../shared/types.js';

const QUICK_STAPLES = [
  'Milk',
  'Eggs',
  'Bread',
  'Butter',
  'Bananas',
  'Apples',
  'Chicken Breasts',
  'Cheese',
  'Coffee',
  'Paper Towels',
];



export const ListsView: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedListId, setSelectedListId] = useState<string>('list-groceries');
  const [newItemText, setNewItemText] = useState('');
  const [newItemQty, setNewItemQty] = useState('');
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListGrocery, setNewListGrocery] = useState(true);
  const [editingList, setEditingList] = useState<TaskList | null>(null);

  const { data: lists = [] } = useQuery({
    queryKey: ['lists'],
    queryFn: () => apiFetch<TaskList[]>('/api/lists'),
  });

  const activeList = useMemo(
    () => lists.find((l) => l.id === selectedListId) || lists[0],
    [lists, selectedListId]
  );

  const itemsKey = ['lists', activeList?.id, 'items'];
  const { data: items = [] } = useQuery({
    queryKey: itemsKey,
    queryFn: () => apiFetch<ListItem[]>(`/api/lists/${activeList!.id}/items`),
    enabled: Boolean(activeList?.id),
  });

  // 0ms Optimistic Add Item with parseItemInput to prevent string flicker
  const addItemMutation = useMutation({
    mutationFn: async (vars: { text: string; quantity?: string }) =>
      apiFetch<ListItem>(`/api/lists/${activeList!.id}/items`, {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      const prev = queryClient.getQueryData<ListItem[]>(itemsKey) || [];
      const parsed = vars.quantity
        ? { text: vars.text, quantity: vars.quantity, category: classifyGroceryItem(vars.text) }
        : parseItemInput(vars.text);
      const optimistic: ListItem = {
        id: `temp-${Date.now()}`,
        listId: activeList!.id,
        text: parsed.text,
        quantity: parsed.quantity || '',
        category: (parsed.category as GroceryCategory) || 'Other',
        checked: false,
        addedByMemberId: null,
        recipeSourceTitle: null,
        updatedAt: new Date().toISOString(),
      };
      queryClient.setQueryData<ListItem[]>(itemsKey, [optimistic, ...prev]);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(itemsKey, ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    },
  });

  // 0ms Optimistic Check Toggle
  // Aisle moves (remembered server-side) and store order (household setting)
  const [movingItem, setMovingItem] = useState<ListItem | null>(null);
  const [editingStoreOrder, setEditingStoreOrder] = useState(false);
  const { data: appSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<AppSettings>('/api/settings'),
  });
  const aisleOrder = useMemo(() => orderAisles(appSettings?.groceryAisleOrder), [appSettings?.groceryAisleOrder]);

  const moveItemMutation = useMutation({
    mutationFn: ({ item, category }: { item: ListItem; category: GroceryCategory }) =>
      apiFetch<ListItem>(`/api/lists/items/${item.id}`, { method: 'PUT', body: JSON.stringify({ category }) }),
    onMutate: async ({ item, category }) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      const prev = queryClient.getQueryData<ListItem[]>(itemsKey) || [];
      queryClient.setQueryData<ListItem[]>(itemsKey, prev.map((i) => (i.id === item.id ? { ...i, category } : i)));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(itemsKey, ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['lists'] }),
  });

  const storeOrderMutation = useMutation({
    mutationFn: (order: GroceryCategory[]) =>
      apiFetch<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify({ groceryAisleOrder: order }) }),
    onMutate: (order) => {
      queryClient.setQueryData<AppSettings>(['settings'], (prev) => (prev ? { ...prev, groceryAisleOrder: order } : prev));
    },
    onSuccess: () => setEditingStoreOrder(false),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const toggleItemMutation = useMutation({
    mutationFn: async (item: ListItem) =>
      apiFetch<ListItem>(`/api/lists/items/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({ checked: !item.checked }),
      }),
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      const prev = queryClient.getQueryData<ListItem[]>(itemsKey) || [];
      queryClient.setQueryData<ListItem[]>(
        itemsKey,
        prev.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i))
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(itemsKey, ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    },
  });

  const clearCheckedMutation = useMutation({
    mutationFn: async () =>
      apiFetch(`/api/lists/${activeList!.id}/clear-checked`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    },
  });

  const createListMutation = useMutation({
    mutationFn: async () =>
      apiFetch<TaskList>('/api/lists', {
        method: 'POST',
        body: JSON.stringify({
          name: newListName.trim(),
          emoji: newListGrocery ? '🛒' : '📝',
          isGrocery: newListGrocery,
        }),
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      setSelectedListId(created.id);
      setCreatingList(false);
      setNewListName('');
    },
  });

  const updateListMutation = useMutation({
    mutationFn: async (vars: { id: string; name: string; emoji: string; isGrocery: boolean }) =>
      apiFetch<TaskList>(`/api/lists/${vars.id}`, {
        method: 'PUT',
        body: JSON.stringify(vars),
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['lists'] });
      const prevLists = queryClient.getQueryData<TaskList[]>(['lists']) || [];
      queryClient.setQueryData<TaskList[]>(
        ['lists'],
        prevLists.map((l) => (l.id === vars.id ? { ...l, ...vars } : l))
      );
      return { prevLists };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevLists) {
        queryClient.setQueryData(['lists'], ctx.prevLists);
      }
    },
    onSuccess: () => {
      setEditingList(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    },
  });

  const deleteListMutation = useMutation({
    mutationFn: async (id: string) =>
      apiFetch(`/api/lists/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['lists'] });
      const prevLists = queryClient.getQueryData<TaskList[]>(['lists']) || [];
      queryClient.setQueryData<TaskList[]>(
        ['lists'],
        prevLists.filter((l) => l.id !== id)
      );
      if (selectedListId === id) {
        const nextList = prevLists.find((l) => l.id !== id);
        if (nextList) setSelectedListId(nextList.id);
      }
      return { prevLists };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevLists) {
        queryClient.setQueryData(['lists'], ctx.prevLists);
      }
    },
    onSuccess: () => {
      setEditingList(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    },
  });

  const uncheckedItems = useMemo(() => items.filter((i) => !i.checked), [items]);
  const checkedItems = useMemo(() => items.filter((i) => i.checked), [items]);

  const groupedUnchecked = useMemo(() => {
    if (!activeList?.isGrocery) {
      return [{ category: 'Other' as GroceryCategory, items: uncheckedItems }];
    }
    const groups: Array<{ category: GroceryCategory; items: ListItem[] }> = [];
    for (const cat of aisleOrder) {
      const catItems = uncheckedItems.filter((i) => i.category === cat);
      if (catItems.length > 0) {
        groups.push({ category: cat, items: catItems });
      }
    }
    return groups;
  }, [activeList?.isGrocery, uncheckedItems, aisleOrder]);

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemText.trim() || !activeList) return;
    addItemMutation.mutate({ text: newItemText.trim(), quantity: newItemQty.trim() });
    setNewItemText('');
    setNewItemQty('');
  };

  return (
    <div className="h-full flex flex-col md:flex-row gap-4 min-h-0">
      {/* Left Lists Sidebar (Horizontal pills on mobile, vertical column on 1080p wall) */}
      <div className="w-full md:w-64 shrink-0 flex md:flex-col gap-2 overflow-x-auto md:overflow-y-auto pb-1">
        {lists.map((l) => {
          const active = l.id === activeList?.id;
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => setSelectedListId(l.id)}
              className={`px-4 py-3.5 rounded-2xl border text-left flex items-center justify-between gap-2 shrink-0 transition active:scale-[0.98] ${
                active
                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                  : 'bg-white text-slate-700 border-stone-200 hover:bg-stone-50'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-xl">{l.emoji}</span>
                <span className="font-extrabold truncate">{l.name}</span>
              </div>
              {(l.uncheckedCount ?? 0) > 0 && (
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold ${
                    active ? 'bg-white/20 text-white' : 'bg-stone-100 text-slate-700'
                  }`}
                >
                  {l.uncheckedCount}
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setCreatingList(true)}
          className="px-4 py-3 rounded-2xl border border-dashed border-stone-300 text-stone-500 hover:text-slate-800 hover:border-stone-400 font-bold text-sm flex items-center gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" />
          New List
        </button>

        {creatingList && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newListName.trim()) createListMutation.mutate();
            }}
            className="bg-white rounded-2xl border border-stone-200 p-3 space-y-2.5 shadow-sm"
          >
            <input
              type="text"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="List name..."
              autoFocus
              className="w-full h-10 px-3 rounded-xl bg-stone-50 border border-stone-200 text-sm font-semibold"
            />
            <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={newListGrocery}
                onChange={(e) => setNewListGrocery(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              Group by grocery aisles
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCreatingList(false)}
                className="flex-1 h-10 min-h-[40px] rounded-xl bg-stone-100 text-xs font-bold flex items-center justify-center"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 h-10 min-h-[40px] rounded-xl bg-sky-600 text-white text-xs font-bold flex items-center justify-center"
              >
                Create
              </button>
            </div>
          </form>
        )}
      </div>

      {movingItem && (
        <AislePickerSheet
          itemText={movingItem.text}
          current={movingItem.category}
          onClose={() => setMovingItem(null)}
          onPick={(category) => {
            if (category !== movingItem.category) moveItemMutation.mutate({ item: movingItem, category });
            setMovingItem(null);
          }}
        />
      )}
      {editingStoreOrder && (
        <StoreOrderSheet
          order={aisleOrder}
          saving={storeOrderMutation.isPending}
          onClose={() => setEditingStoreOrder(false)}
          onSave={(order) => storeOrderMutation.mutate(order)}
        />
      )}

      {/* Main List Workspace */}
      {activeList && (
        <div className="flex-1 flex flex-col bg-white rounded-3xl border border-stone-200/90 shadow-2xs overflow-hidden min-h-0">
          {/* Quick Entry Bar */}
          <div className="p-4 border-b border-stone-100 space-y-3 bg-stone-50/40">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-2xl">{activeList.emoji}</span>
                <h2 className="text-xl font-extrabold text-slate-800 truncate">{activeList.name}</h2>
                {activeList.isGrocery && (
                  <span className="hidden sm:inline-flex text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full whitespace-nowrap">
                    Grocery Auto-Sort
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
              {activeList.isGrocery && (
                <button
                  type="button"
                  onClick={() => setEditingStoreOrder(true)}
                  className="h-10 min-h-[40px] px-3.5 rounded-xl bg-white hover:bg-stone-100 border border-stone-200 text-xs font-bold text-slate-700 flex items-center gap-1.5 shadow-2xs active:scale-95"
                  title="Arrange aisles in your store's order"
                >
                  <ListOrdered className="w-4 h-4 text-stone-500" />
                  <span className="hidden sm:inline">Store order</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditingList(activeList)}
                className="h-10 min-h-[40px] px-3.5 rounded-xl bg-white hover:bg-stone-100 border border-stone-200 text-xs font-bold text-slate-700 flex items-center gap-1.5 shadow-2xs active:scale-95"
                title="Edit List"
              >
                <Settings2 className="w-4 h-4 text-stone-500" />
                <span className="hidden sm:inline">Manage List</span>
              </button>
              </div>
            </div>

            <form onSubmit={handleAddSubmit} className="flex gap-2">
              <input
                type="text"
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                placeholder={
                  activeList.isGrocery
                    ? `Add to ${activeList.name} (auto-sorts by aisle)...`
                    : `Add item to ${activeList.name}...`
                }
                className="flex-1 min-w-0 h-12 px-3.5 sm:px-4 rounded-2xl bg-white border border-stone-200 text-sm sm:text-base font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <input
                type="text"
                value={newItemQty}
                onChange={(e) => setNewItemQty(e.target.value)}
                placeholder="Qty"
                className="w-16 sm:w-24 shrink-0 h-12 px-2 sm:px-3 rounded-2xl bg-white border border-stone-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <button
                type="submit"
                className="shrink-0 h-12 px-3.5 sm:px-5 rounded-2xl bg-sky-600 hover:bg-sky-700 active:scale-95 text-white font-bold flex items-center gap-1.5 shadow-sm"
              >
                <Plus className="w-5 h-5" />
                Add
              </button>
            </form>

            {/* 1-Tap Staples Bar for Grocery Lists */}
            {activeList.isGrocery && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                <span className="text-xs font-bold uppercase tracking-wider text-stone-400 mr-1 flex items-center gap-1 shrink-0">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  Quick Add:
                </span>
                {QUICK_STAPLES.map((staple) => (
                  <button
                    key={staple}
                    type="button"
                    onClick={() => addItemMutation.mutate({ text: staple })}
                    className="h-10 min-h-[40px] px-3.5 rounded-xl bg-white hover:bg-emerald-50 active:scale-95 border border-stone-200 text-xs font-bold text-slate-700 shrink-0 transition flex items-center justify-center"
                  >
                    + {staple}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items Grid */}
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {uncheckedItems.length === 0 && (
              <div className="py-12 text-center text-stone-400">
                <ShoppingCart className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="font-bold text-base">Nothing unchecked on {activeList.name}</p>
              </div>
            )}

            {activeList.isGrocery ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {groupedUnchecked.map((group) => (
                  <div
                    key={group.category}
                    className="rounded-2xl border border-stone-200/80 bg-[#FAF8F5]/70 p-3.5 space-y-2"
                  >
                    <div className="text-xs font-extrabold uppercase tracking-wider text-stone-500 flex items-center gap-1.5 px-1">
                      <span>{AISLE_ICONS[group.category]}</span>
                      <span>{group.category}</span>
                      <span className="ml-auto text-stone-400">{group.items.length}</span>
                    </div>
                    <div className="space-y-1.5">
                      {group.items.map((item) => (
                        <div
                          key={item.id}
                          className="group w-full bg-white hover:bg-stone-50 rounded-xl border border-stone-200/80 px-3.5 py-2.5 flex items-center gap-3 text-left shadow-2xs transition"
                        >
                          <button
                            type="button"
                            onClick={() => toggleItemMutation.mutate(item)}
                            className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl border-2 border-stone-300 hover:border-sky-500 bg-white flex items-center justify-center shrink-0 transition active:scale-95"
                            title="Check item"
                          >
                            {item.checked && <Check className="w-5 h-5 text-emerald-600" />}
                          </button>
                          <div
                            className="flex-1 min-w-0 cursor-pointer"
                            onClick={() => toggleItemMutation.mutate(item)}
                          >
                            <span className="font-bold text-slate-800 text-[15px]">
                              {item.text}
                            </span>
                            {item.recipeSourceTitle && (
                              <span className="ml-2 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                                {item.recipeSourceTitle}
                              </span>
                            )}
                          </div>
                          {item.quantity && (
                            <span className="text-xs font-extrabold text-slate-600 bg-stone-100 px-2.5 py-1 rounded-lg">
                              {item.quantity}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setMovingItem(item)}
                            className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl text-stone-400 hover:text-sky-600 hover:bg-sky-50 flex items-center justify-center shrink-0"
                            aria-label={`Move ${item.text} to another aisle`}
                            title="Move to another aisle"
                          >
                            <ArrowRightLeft className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {uncheckedItems.map((item) => (
                  <div
                    key={item.id}
                    className="group w-full bg-[#FAF8F5] hover:bg-stone-100 rounded-2xl border border-stone-200 px-4 py-2.5 flex items-center gap-3 text-left transition"
                  >
                    <button
                      type="button"
                      onClick={() => toggleItemMutation.mutate(item)}
                      className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl border-2 border-stone-300 bg-white flex items-center justify-center shrink-0 transition active:scale-95"
                      title="Check item"
                    >
                      {item.checked && <Check className="w-5 h-5 text-emerald-600" />}
                    </button>
                    <span
                      className="font-bold text-slate-800 text-base flex-1 cursor-pointer"
                      onClick={() => toggleItemMutation.mutate(item)}
                    >
                      {item.text}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Checked Items Section (Tap to re-add staple!) */}
            {checkedItems.length > 0 && (
              <div className="pt-3 border-t border-stone-100 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-stone-400">
                    Completed / Checked ({checkedItems.length}) — tap item to uncheck
                  </span>
                  <button
                    type="button"
                    onClick={() => clearCheckedMutation.mutate()}
                    className="h-10 min-h-[40px] px-3.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear Checked
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {checkedItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleItemMutation.mutate(item)}
                      className="h-10 min-h-[40px] px-3.5 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-500 line-through text-sm font-semibold flex items-center gap-2 active:scale-95"
                    >
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>{item.text}</span>
                      {item.quantity && <span className="text-xs">({item.quantity})</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit List Modal */}
      {editingList && (
        <EditListModal
          list={editingList}
          onClose={() => setEditingList(null)}
          onSave={(vars) => updateListMutation.mutate(vars)}
          onDelete={(id) => deleteListMutation.mutate(id)}
        />
      )}
    </div>
  );
};

const EditListModal: React.FC<{
  list: TaskList;
  onClose: () => void;
  onSave: (vars: { id: string; name: string; emoji: string; isGrocery: boolean }) => void;
  onDelete: (id: string) => void;
}> = ({ list, onClose, onSave, onDelete }) => {
  const [name, setName] = useState(list.name);
  const [emoji, setEmoji] = useState(list.emoji || '📝');
  const [isGrocery, setIsGrocery] = useState(list.isGrocery);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const EMOJI_OPTIONS = ['🛒', '📝', '🏠', '🎯', '🎒', '🍳', '✨', '🎉'];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-stone-200 max-w-md w-full p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-extrabold text-slate-800">Edit List</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full bg-stone-100 flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">
            List Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="List name..."
            className="w-full h-12 px-4 rounded-xl bg-stone-50 border border-stone-200 font-semibold text-base focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1.5">
            Emoji Icon
          </label>
          <div className="flex flex-wrap gap-2">
            {EMOJI_OPTIONS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setEmoji(em)}
                className={`w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl text-lg flex items-center justify-center border transition ${
                  emoji === em
                    ? 'bg-sky-50 border-sky-500 ring-2 ring-sky-200'
                    : 'bg-stone-50 border-stone-200'
                }`}
              >
                {em}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-sm font-bold text-slate-700 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={isGrocery}
            onChange={(e) => setIsGrocery(e.target.checked)}
            className="w-5 h-5 rounded"
          />
          Group by grocery aisles (Produce, Dairy, Meat...)
        </label>

        <div className="flex items-center justify-between pt-3 border-t border-stone-100">
          {confirmDelete ? (
            <button
              type="button"
              onClick={() => onDelete(list.id)}
              className="h-11 min-h-[40px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs"
            >
              Confirm Delete?
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="h-11 min-h-[40px] px-3.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete List</span>
            </button>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-11 min-h-[40px] px-4 rounded-xl bg-stone-100 hover:bg-stone-200 font-bold text-sm text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() =>
                onSave({
                  id: list.id,
                  name: name.trim() || list.name,
                  emoji,
                  isGrocery,
                })
              }
              className="h-11 min-h-[40px] px-5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm shadow-sm"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
