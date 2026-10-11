import { useQuery } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useState } from "react";

import { ComingSoon } from "@/components/layout/ComingSoon";
import { DemoTag } from "@/components/layout/DemoTag";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorState, PageHeader, Skeleton } from "@/components/ui/Feedback";
import { useSession } from "@/features/auth/session";
import { ApiError } from "@/lib/api/client";
import { profileApi } from "@/lib/api/endpoints";

export function ProfilePage() {
  const { state, logout, exitDemo } = useSession();
  const [busy, setBusy] = useState(false);
  const live = state.status === "authenticated";
  const profile = useQuery({ queryKey: ["live", "profile"], queryFn: ({ signal }) => profileApi.get(signal),
                             enabled: live });

  return (
    <>
      <PageHeader title="Profile & settings" />
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <Card aria-labelledby="account">
          <CardHeader id="account" title={<span className="flex items-center gap-2">Account{!live && <DemoTag />}</span>} />
          {live ? (
            <dl className="space-y-3 text-sm">
              <div><dt className="text-ink-muted">Email</dt><dd className="text-ink">{state.user.email}</dd></div>
              <div>
                <dt className="text-ink-muted">Display name</dt>
                <dd className="text-ink">
                  {profile.isPending ? <Skeleton className="mt-1 h-5 w-32" />
                    : profile.isError ? <ErrorState message={profile.error instanceof ApiError ? profile.error.message : "Couldn't load your profile."}
                                                    onRetry={() => profile.refetch()} />
                    : profile.data.profile?.display_name ?? <span className="text-ink-muted">Not set</span>}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-ink-muted">You're exploring sample data. There is no account and nothing is saved.</p>
          )}
          <div className="mt-6">
            {live ? (
              <Button variant="secondary" loading={busy} icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
                      onClick={async () => { setBusy(true); await logout(); }}>
                Sign out
              </Button>
            ) : (
              <Button variant="secondary" onClick={exitDemo}>Exit demo</Button>
            )}
          </div>
        </Card>
        <ComingSoon feature="Profile editing" tryDemo={false} plans={[
          "Change your name, food preferences and allergies or ingredients to avoid.",
          "Set or skip nutrition targets, and say where a target came from.",
          "Download or delete your data, and delete your account.",
        ]} />
      </div>
    </>
  );
}
