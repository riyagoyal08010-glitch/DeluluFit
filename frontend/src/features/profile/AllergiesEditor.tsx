import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, ErrorState } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { profileApi } from "@/lib/api/endpoints";
import { invalidateMenus, liveKeys } from "@/lib/api/queryKeys";
import type { Allergen, AllergySeverity, UserAllergy } from "@/types/api";

import { ALLERGEN_LABELS, options, SEVERITY_LABELS } from "./options";
import { apiMessage, SavedNotice } from "./shared";

const MAX = 30;
type Draft = Omit<UserAllergy, "id">;
const toDraft = (items: UserAllergy[]): Draft[] =>
  items.map(({ allergen, custom_label, severity, notes }) => ({ allergen, custom_label, severity, notes }));
const keyOf = (d: Draft) => `${d.allergen}|${(d.custom_label ?? "").trim().toLowerCase()}`;
const describe = (d: Draft) => (d.allergen === "other" ? d.custom_label ?? "Other" : ALLERGEN_LABELS[d.allergen]);

/**
 * Allergies and severity (PUT /profile/allergies replaces the list). Recording an allergy here
 * does not make any food safe or unsafe: DeluluFit does not check meals or menus against it.
 */
export function AllergiesEditor({ saved, onDirtyChange }:
  { saved: UserAllergy[]; onDirtyChange?: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();
  // The last list the server confirmed: the save response, until a refetched bundle replaces it.
  const [baseline, setBaseline] = useState<Draft[]>(() => toDraft(saved));
  const [draft, setDraft] = useState<Draft[]>(() => toDraft(saved));
  const [allergen, setAllergen] = useState<Allergen>("peanut");
  const [customLabel, setCustomLabel] = useState("");
  const [severity, setSeverity] = useState<AllergySeverity>("unknown");
  const [notes, setNotes] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    setBaseline(toDraft(saved));
    if (!dirty) setDraft(toDraft(saved));
  }, [saved]);

  const save = useMutation({
    mutationFn: (items: Draft[]) => profileApi.replaceAllergies(items),
    onSuccess: async (rows) => {
      setBaseline(toDraft(rows));
      setDraft(toDraft(rows));
      setNotice("Allergies saved.");
      await queryClient.invalidateQueries({ queryKey: liveKeys.profile });
      await invalidateMenus(queryClient);  // menu suggestions carry allergy cautions from this list
    },
  });

  function add(e: FormEvent) {
    e.preventDefault();
    const label = customLabel.trim().replace(/\s+/g, " ");
    if (allergen === "other" && !label) return setAddError("Describe the allergy.");
    if (label.length > 80) return setAddError("Use at most 80 characters.");
    if (notes.length > 280) return setAddError("Notes can be at most 280 characters.");
    if (draft.length >= MAX) return setAddError(`You can list up to ${MAX} allergies.`);
    const item: Draft = { allergen, custom_label: allergen === "other" ? label : null, severity, notes: notes.trim() || null };
    if (draft.some((d) => keyOf(d) === keyOf(item))) return setAddError(`${describe(item)} is already listed. Change it in the list instead.`);
    setDraft((d) => [...d, item]);
    setCustomLabel("");
    setNotes("");
    setAddError(null);
    setNotice(null);
  }

  return (
    <Card aria-labelledby="allergy-title" id="allergies">
      <CardHeader id="allergy-title" title="Allergies and intolerances"
                  description="Changes are saved together when you press Save." />
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          DeluluFit does not check meals or menus against your allergies yet. A missing allergen in our food data or a dish
          name never means a food is safe — always confirm ingredients with your mess.
        </p>
        {notice && !dirty && <SavedNotice>{notice}</SavedNotice>}
        {draft.length === 0 ? (
          <p className="text-sm text-ink-muted">No allergies listed.</p>
        ) : (
          <ul className="divide-y divide-line/70 rounded-control border border-line/70" aria-label="Allergies list">
            {draft.map((d, i) => (
              <li key={keyOf(d)} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 text-sm text-ink">
                  {describe(d)}
                  {d.notes && <span className="block text-xs text-ink-muted">{d.notes}</span>}
                </span>
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`sev-${i}`}>Severity for {describe(d)}</label>
                  <select id={`sev-${i}`} value={d.severity}
                          onChange={(e) => setDraft((all) => all.map((x, j) => (j === i ? { ...x, severity: e.target.value as AllergySeverity } : x)))}
                          className="h-10 rounded-control border border-line/50 bg-surface px-2 text-sm text-ink focus-visible:shadow-focus">
                    {options(SEVERITY_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <button type="button" aria-label={`Remove ${describe(d)}`} onClick={() => setDraft((all) => all.filter((_, j) => j !== i))}
                          className="rounded-control p-2 text-ink-muted hover:bg-surface-raised hover:text-danger">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={add} noValidate className="space-y-3" aria-label="Add an allergy">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Allergen" value={allergen} onChange={(e) => { setAllergen(e.target.value as Allergen); setAddError(null); }}
                    options={options(ALLERGEN_LABELS)} />
            {allergen === "other" && (
              <Input label="Describe it" value={customLabel} maxLength={80} placeholder="e.g. Kiwi"
                     onChange={(e) => { setCustomLabel(e.target.value); setAddError(null); }} />
            )}
            <Select label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as AllergySeverity)}
                    options={options(SEVERITY_LABELS)} />
          </div>
          <Input label="Notes" optional value={notes} maxLength={280} onChange={(e) => setNotes(e.target.value)} />
          {addError && <p role="alert" className="text-sm text-danger">{addError}</p>}
          <Button type="submit" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />}>Add allergy</Button>
        </form>

        {save.isError && <ErrorState title="Couldn't save your allergies" message={`${apiMessage(save.error)} Your changes are still here; try again.`} />}
        <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          {dirty && <Badge tone="warning" className="self-start sm:self-center">Unsaved changes</Badge>}
          {dirty && <Button variant="ghost" disabled={save.isPending} onClick={() => { save.reset(); setDraft(baseline); }}>Discard changes</Button>}
          <Button loading={save.isPending} disabled={!dirty} onClick={() => { if (!save.isPending) { setNotice(null); save.mutate(draft); } }}>
            Save allergies
          </Button>
        </div>
      </div>
    </Card>
  );
}
