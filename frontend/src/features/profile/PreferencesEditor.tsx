import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, ErrorState } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { profileApi } from "@/lib/api/endpoints";
import { invalidateMenus, liveKeys } from "@/lib/api/queryKeys";
import type { FoodPreference, PreferenceKind } from "@/types/api";

import { options, PREFERENCE_LABELS } from "./options";
import { apiMessage, looseKey, SavedNotice } from "./shared";

const MAX = 100;
type Draft = { label: string; preference: PreferenceKind };
const toDraft = (items: FoodPreference[]): Draft[] => items.map(({ label, preference }) => ({ label, preference }));
const same = (a: Draft[], b: Draft[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Foods the student likes, dislikes or wants to avoid (PUT /profile/preferences replaces the list).
 * The draft is separate from the saved list, so a failed save never changes what is shown as saved.
 */
export function PreferencesEditor({ saved, onDirtyChange }:
  { saved: FoodPreference[]; onDirtyChange?: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();
  // The last list the server confirmed: the save response, until a refetched bundle replaces it.
  const [baseline, setBaseline] = useState<Draft[]>(() => toDraft(saved));
  const [draft, setDraft] = useState<Draft[]>(() => toDraft(saved));
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<PreferenceKind>("like");
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = !same(draft, baseline);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  // Server changes replace the draft only when there are no unsaved edits.
  useEffect(() => {
    setBaseline(toDraft(saved));
    if (!dirty) setDraft(toDraft(saved));
  }, [saved]);

  const save = useMutation({
    mutationFn: (items: Draft[]) => profileApi.replacePreferences(items),
    onSuccess: async (rows) => {
      setBaseline(toDraft(rows));
      setDraft(toDraft(rows));
      setNotice("Food preferences saved.");
      await queryClient.invalidateQueries({ queryKey: liveKeys.profile });
      await invalidateMenus(queryClient);  // menu suggestions are ranked from these preferences
    },
  });

  function add(e: FormEvent) {
    e.preventDefault();
    const clean = label.trim().replace(/\s+/g, " ");
    if (!looseKey(clean)) return setAddError("Enter a food name using letters or numbers.");
    if (clean.length > 80) return setAddError("Use at most 80 characters.");
    if (draft.length >= MAX) return setAddError(`You can list up to ${MAX} foods.`);
    if (draft.some((d) => looseKey(d.label) === looseKey(clean))) return setAddError(`“${clean}” is already in your list.`);
    setDraft((d) => [...d, { label: clean, preference: kind }]);
    setLabel("");
    setAddError(null);
    setNotice(null);
  }

  return (
    <Card aria-labelledby="prefs-title" id="preferences">
      <CardHeader id="prefs-title" title="Food preferences"
                  description="Foods you like, dislike or avoid. Changes are saved together when you press Save." />
      <div className="space-y-4">
        {notice && !dirty && <SavedNotice>{notice}</SavedNotice>}
        {draft.length === 0 ? (
          <p className="text-sm text-ink-muted">No food preferences listed.</p>
        ) : (
          <ul className="divide-y divide-line/70 rounded-control border border-line/70" aria-label="Food preferences list">
            {draft.map((d, i) => {
              const savedRow = saved.find((s) => looseKey(s.label) === looseKey(d.label));
              return (
                <li key={`${d.label}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 truncate text-sm text-ink">
                    {d.label}
                    {savedRow?.food_id && <span className="ml-2 text-xs text-ink-muted">in food list</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`pref-${i}`}>Preference for {d.label}</label>
                    <select id={`pref-${i}`} value={d.preference}
                            onChange={(e) => setDraft((all) => all.map((x, j) => (j === i ? { ...x, preference: e.target.value as PreferenceKind } : x)))}
                            className="h-10 rounded-control border border-line/50 bg-surface px-2 text-sm text-ink focus-visible:shadow-focus">
                      {options(PREFERENCE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <button type="button" aria-label={`Remove ${d.label}`} onClick={() => setDraft((all) => all.filter((_, j) => j !== i))}
                            className="rounded-control p-2 text-ink-muted hover:bg-surface-raised hover:text-danger">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={add} noValidate className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-start" aria-label="Add a food preference">
          <Input label="Food" value={label} maxLength={80} placeholder="e.g. Rajma, karela" error={addError ?? undefined}
                 onChange={(e) => { setLabel(e.target.value); setAddError(null); }} />
          <Select label="Preference" value={kind} onChange={(e) => setKind(e.target.value as PreferenceKind)}
                  options={options(PREFERENCE_LABELS)} />
          <Button type="submit" variant="secondary" className="sm:mt-7" icon={<Plus className="h-4 w-4" aria-hidden="true" />}>Add</Button>
        </form>

        <p className="text-xs text-ink-muted">
          “Avoid” is a preference, not an allergy check. For allergies, use the section below; DeluluFit doesn't check meals against either yet.
        </p>
        {save.isError && <ErrorState title="Couldn't save your food preferences" message={`${apiMessage(save.error)} Your changes are still here; try again.`} />}
        <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          {dirty && <Badge tone="warning" className="self-start sm:self-center">Unsaved changes</Badge>}
          {dirty && <Button variant="ghost" disabled={save.isPending} onClick={() => { save.reset(); setDraft(baseline); }}>Discard changes</Button>}
          <Button loading={save.isPending} disabled={!dirty} onClick={() => { if (!save.isPending) { setNotice(null); save.mutate(draft); } }}>
            Save food preferences
          </Button>
        </div>
      </div>
    </Card>
  );
}
