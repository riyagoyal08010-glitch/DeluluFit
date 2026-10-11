import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useForm, type FieldValues, type Path, type UseFormSetError } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { Brand } from "@/components/layout/Brand";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/Feedback";
import { Checkbox, Input } from "@/components/ui/Field";
import { ApiError } from "@/lib/api/client";

import { loginSchema, registerSchema, type LoginValues, type RegisterValues } from "./schemas";
import { useSession } from "./session";

function AuthLayout({ title, subtitle, children, footer }:
  { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <Link to="/" className="mb-8 self-start rounded-control"><Brand /></Link>
      <Card>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mb-6 mt-1 text-sm text-ink-muted">{subtitle}</p>
        {children}
      </Card>
      <p className="mt-6 text-center text-sm text-ink-muted">{footer}</p>
    </main>
  );
}

function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown} className="rounded-control p-2 text-ink-muted hover:text-ink">
      {shown ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
    </button>
  );
}

/** Apply a server error to the form: field messages where possible, otherwise a form-level message. */
function applyServerError<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>,
                                                 fieldMap: Record<string, Path<T>>): string | null {
  if (!(err instanceof ApiError)) return "Something unexpected happened. Please try again.";
  const fields = err.fieldErrors();
  let mapped = false;
  for (const [apiField, msg] of Object.entries(fields)) {
    const field = fieldMap[apiField];
    if (field) {
      setError(field, { message: msg });
      mapped = true;
    }
  }
  return mapped ? null : err.message;
}

function useRedirectTarget(): string {
  const from = (useLocation().state as { from?: string } | null)?.from;
  return from && from.startsWith("/app") ? from : "/app";
}

export function LoginPage() {
  const { state, login } = useSession();
  const navigate = useNavigate();
  const target = useRedirectTarget();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } =
    useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  if (state.status === "authenticated") return <Navigate to={target} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values.email, values.password);
      navigate(target, { replace: true });
    } catch (err) {
      setFormError(applyServerError(err, setError, { email: "email", password: "password" }));
    }
  });

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to see your meals and spending."
                footer={<>New to DeluluFit? <Link className="text-accent hover:underline" to="/register">Create an account</Link></>}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {state.status === "anonymous" && state.notice && <p role="status" className="rounded-control border border-success/30 bg-success/10 p-3 text-sm text-success">{state.notice}</p>}
        {state.status === "anonymous" && state.connectionError && !formError && (
          <ErrorState title="Can't reach the server" message={state.connectionError} />
        )}
        {formError && <ErrorState title="Couldn't sign in" message={formError} />}
        <Input label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
        <Input label="Password" type={showPassword ? "text" : "password"} autoComplete="current-password"
               error={errors.password?.message} {...register("password")}
               trailing={<PasswordToggle shown={showPassword} onToggle={() => setShowPassword((v) => !v)} />} />
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Sign in</Button>
        <p className="text-xs text-ink-muted">
          Password reset isn't available yet. If you're locked out, you'll need to create a new account.
        </p>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { state, register: registerAccount } = useSession();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } =
    useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  if (state.status === "authenticated") return <Navigate to="/app" replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await registerAccount(values.email, values.password, values.displayName?.trim() || null);
      navigate("/app", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "email_taken") {
        setError("email", { message: "An account with this email already exists." });
        return;
      }
      setFormError(applyServerError(err, setError,
                                    { email: "email", password: "password", display_name: "displayName" }));
    }
  });

  return (
    <AuthLayout title="Create your account" subtitle="Log meals, see estimates and track food spending."
                footer={<>Already have an account? <Link className="text-accent hover:underline" to="/login">Sign in</Link></>}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <ErrorState title="Couldn't create your account" message={formError} />}
        <Input label="What should we call you?" optional autoComplete="nickname" error={errors.displayName?.message}
               {...register("displayName")} />
        <Input label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
        <Input label="Password" type={showPassword ? "text" : "password"} autoComplete="new-password"
               hint="At least 10 characters." error={errors.password?.message} {...register("password")}
               trailing={<PasswordToggle shown={showPassword} onToggle={() => setShowPassword((v) => !v)} />} />
        <Input label="Confirm password" type={showPassword ? "text" : "password"} autoComplete="new-password"
               error={errors.confirmPassword?.message} {...register("confirmPassword")} />
        <Checkbox error={errors.acknowledge?.message} {...register("acknowledge")}
                  label="I understand DeluluFit shows general nutrition estimates for awareness and budgeting. It is not medical advice." />
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Create account</Button>
      </form>
    </AuthLayout>
  );
}
