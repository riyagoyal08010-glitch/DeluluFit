import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, ErrorState } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { useDebouncedValue } from "@/features/meals/portion";
import { profileApi } from "@/lib/api/endpoints";
import { liveKeys } from "@/lib/api/queryKeys";
import type { Institution, ProfileBundle, ProfileInput } from "@/types/api";

import { ACTIVITY_LABELS, CURRENCIES, DIETARY_PATTERN_LABELS, options, timeZones } from "./options";
import { profileSchema, type ProfileFormValues } from "./schemas";
import { apiMessage, applyFieldErrors, SavedNotice } from "./shared";

function toForm(b: ProfileBundle): ProfileFormValues {
  const p = b.profile;
  return {
    displayName: p?.display_name ?? "",
    dietaryPattern: (p?.dietary_pattern as ProfileFormValues["dietaryPattern"]) ?? "no_preference",
    heightCm: p?.height_cm ? String(Number(p.height_cm)) : "",
    weightKg: p?.weight_kg ? String(Number(p.weight_kg)) : "",
    activityLevel: (p?.activity_level as ProfileFormValues["activityLevel"]) ?? "",
    currency: p?.currency ?? "INR",
    timezone: p?.timezone ?? "Asia/Kolkata",
    institutionId: p?.institution_id ?? "",
    hostelId: p?.hostel_id ?? "",
  };
}

function toInput(v: ProfileFormValues): ProfileInput {
  // PUT /profile replaces every field, so every field is always sent.
  return {
    display_name: v.displayName.trim(), dietary_pattern: v.dietaryPattern,
    height_cm: v.heightCm.trim() || null, weight_kg: v.weightKg.trim() || null,
    activity_level: v.activityLevel || null, currency: v.currency, timezone: v.timezone,
    institution_id: v.institutionId || null, hostel_id: v.institutionId && v.hostelId ? v.hostelId : null,
  };
}

const FIELD_MAP = { display_name: "displayName", height_cm: "heightCm", weight_kg: "weightKg", currency: "currency",
                    timezone: "timezone", dietary_pattern: "dietaryPattern", activity_level: "activityLevel" } as const;

export function PersonalProfileForm({ bundle }: { bundle: ProfileBundle }) {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState<string | null>(null);
  const [institution, setInstitution] = useState<Institution | null>(bundle.institution ?? null);
  const { register, handleSubmit, reset, setError, setValue, watch, formState: { errors, isDirty } } =
    useForm<ProfileFormValues>({ resolver: zodResolver(profileSchema), defaultValues: toForm(bundle) });

  // New server data replaces the form only when there are no unsaved edits.
  useEffect(() => {
    if (!isDirty) {
      reset(toForm(bundle));
      setInstitution(bundle.institution ?? null);
    }
  }, [bundle, isDirty, reset]);

  const save = useMutation({
    mutationFn: (input: ProfileInput) => profileApi.update(input),
    onSuccess: async () => {
      setSaved("Profile saved.");
      await queryClient.invalidateQueries({ queryKey: liveKeys.profile });
    },
    onError: (err) => { applyFieldErrors(err, setError, FIELD_MAP); },
  });

  const onSubmit = handleSubmit((values) => {
    if (save.isPending) return;
    setSaved(null);
    // After the server confirms, the submitted values become the clean baseline; the refetched
    // profile then replaces them through the effect above.
    save.mutate(toInput(values), { onSuccess: () => reset(values) });
  });

  const currency = watch("currency");
  const timezone = watch("timezone");
  const institutionId = watch("institutionId");
  const hostelId = watch("hostelId");
  const currencies = CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES];
  const pickInstitution = (inst: Institution | null) => {
    setInstitution(inst);
    setValue("institutionId", inst?.id ?? "", { shouldDirty: true });
    setValue("hostelId", "", { shouldDirty: true });
  };

  return (
    <Card aria-labelledby="personal-title" id="personal" surface="solid">
      <CardHeader id="personal-title" title="Personal profile"
                  description={bundle.profile ? undefined : "You haven't saved a profile yet. Only your name is required."} />
      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Personal profile">
        {saved && !isDirty && <SavedNotice>{saved}</SavedNotice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" autoComplete="nickname" error={errors.displayName?.message} {...register("displayName")} />
          <Select label="Eating pattern" error={errors.dietaryPattern?.message} options={options(DIETARY_PATTERN_LABELS)}
                  hint="Used to describe your choices; it doesn't filter foods yet." {...register("dietaryPattern")} />
        </div>

        <fieldset className="space-y-3 rounded-control border border-line/70 p-4">
          <legend className="px-1 text-sm font-medium">Body and activity <span className="font-normal text-ink-muted">(optional)</span></legend>
          <p className="text-xs text-ink-muted">You can leave these empty. DeluluFit doesn't use them for any calculation yet.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Height (cm)" optional inputMode="decimal" autoComplete="off" error={errors.heightCm?.message} {...register("heightCm")} />
            <Input label="Weight (kg)" optional inputMode="decimal" autoComplete="off" error={errors.weightKg?.message} {...register("weightKg")} />
            <Select label="Activity" options={[{ value: "", label: "Prefer not to say" }, ...options(ACTIVITY_LABELS)]}
                    error={errors.activityLevel?.message} {...register("activityLevel")} />
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Currency" options={currencies.map((c) => ({ value: c, label: c }))} error={errors.currency?.message}
                  hint={currency !== (bundle.profile?.currency ?? "INR")
                    ? "Changing currency: budgets and spending in your old currency won't be included in totals. Nothing is converted."
                    : "Used for budgets and spending."}
                  {...register("currency")} />
          <Select label="Time zone" options={timeZones(timezone).map((z) => ({ value: z, label: z.replace(/_/g, " ") }))}
                  error={errors.timezone?.message}
                  hint="Decides which calendar day your meals and spending belong to. Meals already logged keep their dates."
                  {...register("timezone")} />
        </div>

        <InstitutionPicker institution={institution} hostelId={hostelId} institutionId={institutionId}
                           onInstitution={pickInstitution}
                           onHostel={(id) => setValue("hostelId", id, { shouldDirty: true })} />

        {save.isError && !Object.keys(errors).length && <ErrorState title="Couldn't save your profile" message={apiMessage(save.error)} />}
        {save.isError && Object.keys(errors).length > 0 && <ErrorState title="Couldn't save your profile" message="Check the highlighted fields." />}
        <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          {isDirty && <Badge tone="warning" className="self-start sm:self-center">Unsaved changes</Badge>}
          {isDirty && <Button variant="ghost" onClick={() => { save.reset(); reset(toForm(bundle)); setInstitution(bundle.institution ?? null); }}
                              disabled={save.isPending}>Discard changes</Button>}
          <Button type="submit" loading={save.isPending} disabled={!isDirty}>Save profile</Button>
        </div>
      </form>
    </Card>
  );
}

function InstitutionPicker({ institution, institutionId, hostelId, onInstitution, onHostel }:
  { institution: Institution | null; institutionId: string; hostelId: string;
    onInstitution: (i: Institution | null) => void; onHostel: (id: string) => void }) {
  const [searching, setSearching] = useState(false);
  const [text, setText] = useState("");
  const q = useDebouncedValue(text.trim(), 300);
  const results = useQuery({ queryKey: liveKeys.institutionSearch(q), enabled: searching && q.length > 0,
                             queryFn: ({ signal }) => profileApi.searchInstitutions(q, signal) });
  const hostels = useQuery({ queryKey: liveKeys.hostels(institutionId), enabled: institutionId !== "",
                             queryFn: ({ signal }) => profileApi.hostels(institutionId, signal) });

  return (
    <fieldset className="space-y-3 rounded-control border border-line/70 p-4">
      <legend className="px-1 text-sm font-medium">College and hostel <span className="font-normal text-ink-muted">(optional)</span></legend>
      {institution && !searching ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">{institution.name}{institution.city ? `, ${institution.city}` : ""}</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSearching(true)}>Change</Button>
            <Button variant="ghost" size="sm" onClick={() => onInstitution(null)}>Remove</Button>
          </div>
        </div>
      ) : searching ? (
        <div className="space-y-2">
          <Input label="Search colleges" type="search" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
          {results.isError && <ErrorState message={apiMessage(results.error)} onRetry={() => results.refetch()} />}
          {results.data && results.data.length === 0 && <p className="text-sm text-ink-muted">No colleges match “{q}”. Adding new ones isn't available here yet.</p>}
          {results.data && results.data.length > 0 && (
            <ul className="divide-y divide-line/70 rounded-control border border-line/70" aria-label="Colleges">
              {results.data.map((i) => (
                <li key={i.id}>
                  <button type="button" className="w-full px-3 py-2.5 text-left text-sm hover:bg-surface-raised"
                          onClick={() => { onInstitution(i); setSearching(false); setText(""); }}>
                    {i.name}{i.city ? <span className="text-ink-muted">, {i.city}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button variant="ghost" size="sm" onClick={() => { setSearching(false); setText(""); }}>Cancel</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-muted">Not set. It's only used to label your menus later.</p>
          <Button variant="secondary" size="sm" onClick={() => setSearching(true)}>Choose college</Button>
        </div>
      )}
      {institutionId && !searching && (
        hostels.isError ? <ErrorState message={apiMessage(hostels.error)} onRetry={() => hostels.refetch()} />
          : <Select label="Hostel" value={hostelId} onChange={(e) => onHostel(e.target.value)}
                    disabled={!hostels.data}
                    hint={hostels.data && hostels.data.length === 0 ? "No hostels listed for this college." : undefined}
                    options={[{ value: "", label: "Not set" }, ...(hostels.data ?? []).map((h) => ({ value: h.id, label: h.name }))]} />
      )}
    </fieldset>
  );
}
