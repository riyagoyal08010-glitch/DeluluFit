import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Field";
import { useSession } from "@/features/auth/session";
import { ApiError } from "@/lib/api/client";
import { authApi } from "@/lib/api/endpoints";

import { changePasswordSchema, type ChangePasswordValues } from "./schemas";
import { apiMessage, SavedNotice } from "./shared";

const SESSION_GONE = new Set(["not_authenticated", "session_expired"]);

/** Email, password change, sign out and account deletion. */
export function AccountSettings({ email }: { email: string }) {
  const { logout } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <Card aria-labelledby="account-title" id="account">
      <CardHeader id="account-title" title="Account" />
      <div className="space-y-6">
        <dl className="text-sm">
          <dt className="text-ink-muted">Signed in as</dt>
          <dd className="break-all text-ink">{email}</dd>
        </dl>
        <ChangePassword />
        <div className="flex flex-wrap gap-2 border-t border-line/70 pt-5">
          <Button variant="secondary" loading={signingOut} icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
                  onClick={async () => { setSigningOut(true); await logout(); }}>Sign out</Button>
        </div>
        <DeleteAccount />
      </div>
    </Card>
  );
}

function ChangePassword() {
  const { clearLocalSession } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const { register, handleSubmit, reset, setError, formState: { errors } } =
    useForm<ChangePasswordValues>({ resolver: zodResolver(changePasswordSchema) });
  const change = useMutation({
    mutationFn: (v: ChangePasswordValues) => authApi.changePassword(v.currentPassword, v.newPassword),
    onSuccess: () => { reset(); setOpen(false); setDone(true); },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "invalid_credentials") {
        setError("currentPassword", { message: "Your current password is incorrect." });
      } else if (err instanceof ApiError && SESSION_GONE.has(err.code)) {
        clearLocalSession();
        navigate("/login", { replace: true });
      } else if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        if (fields.new_password) setError("newPassword", { message: fields.new_password });
      }
    },
  });

  if (!open) {
    return (
      <div className="space-y-3">
        {done && <SavedNotice>Password changed. Your other devices were signed out.</SavedNotice>}
        <Button variant="secondary" onClick={() => { setDone(false); change.reset(); setOpen(true); }}>Change password</Button>
      </div>
    );
  }
  const passwordFieldError = change.error instanceof ApiError && change.error.code === "invalid_credentials";
  return (
    <form onSubmit={handleSubmit((v) => { if (!change.isPending) change.mutate(v); })} noValidate className="space-y-3"
          aria-label="Change password">
      <Input label="Current password" type="password" autoComplete="current-password" error={errors.currentPassword?.message}
             {...register("currentPassword")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="New password" type="password" autoComplete="new-password" hint="At least 10 characters."
               error={errors.newPassword?.message} {...register("newPassword")} />
        <Input label="Confirm new password" type="password" autoComplete="new-password"
               error={errors.confirmPassword?.message} {...register("confirmPassword")} />
      </div>
      <p className="text-xs text-ink-muted">Changing your password signs out every other device.</p>
      {change.isError && !passwordFieldError && !errors.newPassword && (
        <ErrorState title="Couldn't change your password" message={apiMessage(change.error)} />
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" disabled={change.isPending} onClick={() => { reset(); change.reset(); setOpen(false); }}>Cancel</Button>
        <Button type="submit" loading={change.isPending}>Change password</Button>
      </div>
    </form>
  );
}

function DeleteAccount() {
  const { clearLocalSession } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const remove = useMutation({
    mutationFn: () => authApi.deleteAccount(password),
    onSuccess: () => {
      // Forget the session and every cached query before leaving, so no private data stays on screen.
      clearLocalSession("Your account and its data have been deleted.");
      navigate("/login", { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && SESSION_GONE.has(err.code)) {
        clearLocalSession();
        navigate("/login", { replace: true });
      }
    },
  });
  const ready = password.length > 0 && typed === "DELETE" && !remove.isPending;
  const close = () => { if (remove.isPending) return; remove.reset(); setPassword(""); setTyped(""); setOpen(false); };
  const error = remove.error instanceof ApiError && remove.error.code === "invalid_credentials"
    ? "That password is incorrect. Your account has not been deleted."
    : remove.isError ? `${apiMessage(remove.error)} Your account has not been deleted.` : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (ready) remove.mutate();
  }

  return (
    <section aria-labelledby="delete-title" className="space-y-3 rounded-control border border-danger/40 bg-[rgb(252_243_243)] p-4">
      <h3 id="delete-title" className="text-sm font-semibold text-ink">Delete account</h3>
      <p className="text-sm text-ink-muted">Permanently delete your account and your data from DeluluFit. This can't be undone.</p>
      <Button variant="danger" onClick={() => setOpen(true)}>Delete account…</Button>

      <Dialog open={open} onClose={close} title="Delete your account?"
              description={
                <div className="space-y-2">
                  <p>This permanently deletes, straight away: your account and sign-ins, profile, food preferences, allergies,
                     nutrition targets, meals and their estimates, budgets and transactions, and any menus and menu photos
                     you uploaded.</p>
                  <p>Not removed: colleges or hostels you added to the shared list (your name is detached from them), and
                     technical server logs that refer to an internal account number. Copies in hosting backups, if any,
                     aren't controlled by this action.</p>
                </div>
              }>
        <form onSubmit={submit} noValidate className="space-y-3" aria-label="Confirm account deletion">
          <Input label="Your password" type="password" autoComplete="current-password" value={password}
                 onChange={(e) => setPassword(e.target.value)} />
          <Input label='Type "DELETE" to confirm' autoComplete="off" autoCapitalize="characters" value={typed}
                 onChange={(e) => setTyped(e.target.value)} />
          {error && <ErrorState title="Couldn't delete your account" message={error} />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={close} disabled={remove.isPending}>Keep my account</Button>
            <Button type="submit" variant="danger" loading={remove.isPending} disabled={!ready}>Delete permanently</Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
