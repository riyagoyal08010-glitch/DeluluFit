import { useQuery } from "@tanstack/react-query";

import { DemoTag } from "@/components/layout/DemoTag";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorState, LoadingState, PageHeader } from "@/components/ui/Feedback";
import { useSession } from "@/features/auth/session";
import { profileApi } from "@/lib/api/endpoints";
import { liveKeys } from "@/lib/api/queryKeys";

import { AccountSettings } from "./AccountSettings";
import { AllergiesEditor } from "./AllergiesEditor";
import { PersonalProfileForm } from "./PersonalProfileForm";
import { PreferencesEditor } from "./PreferencesEditor";
import { apiMessage } from "./shared";
import { TargetsManager } from "./TargetsManager";

const SECTIONS = [
  { id: "personal", label: "Profile" }, { id: "preferences", label: "Food preferences" },
  { id: "allergies", label: "Allergies" }, { id: "targets", label: "Targets" }, { id: "account", label: "Account" },
];

export function ProfilePage() {
  const { state, exitDemo } = useSession();
  return (
    <>
      <PageHeader title="Profile & settings" description="Your details and choices. Only your name is required." />
      {state.status === "authenticated" ? <LiveProfile email={state.user.email} /> : (
        <Card aria-labelledby="demo-account">
          <CardHeader id="demo-account" title={<span className="flex items-center gap-2">Account<DemoTag /></span>} />
          <p className="text-sm text-ink-muted">
            You're exploring sample data. There is no account, nothing is saved, and profile editing is available only
            with a real account.
          </p>
          <Button variant="secondary" className="mt-6" onClick={exitDemo}>Exit demo</Button>
        </Card>
      )}
    </>
  );
}

function LiveProfile({ email }: { email: string }) {
  const bundle = useQuery({ queryKey: liveKeys.profile, queryFn: ({ signal }) => profileApi.get(signal) });
  return (
    <div className="space-y-4">
      <nav aria-label="Profile sections" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}
             className="shrink-0 rounded-full border border-line/40 px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink">
            {s.label}
          </a>
        ))}
      </nav>
      {bundle.isPending ? <LoadingState label="Loading your profile" />
        : bundle.isError ? <ErrorState title="Couldn't load your profile" message={apiMessage(bundle.error)}
                                       onRetry={() => bundle.refetch()} />
        : (
          <>
            <PersonalProfileForm bundle={bundle.data} />
            <PreferencesEditor saved={bundle.data.preferences ?? []} />
            <AllergiesEditor saved={bundle.data.allergies ?? []} />
          </>
        )}
      <TargetsManager />
      <AccountSettings email={email} />
    </div>
  );
}
