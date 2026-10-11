import { z } from "zod";

/** Client-side checks mirror backend/app/schemas/auth.py; the server stays authoritative. */
const email = z.string().trim().min(1, "Enter your email address.").max(254)
  .email("Enter a valid email address.");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});
export type LoginValues = z.infer<typeof loginSchema>;

const registerFields = z.object({
  displayName: z.string().trim().max(80, "Use at most 80 characters.").optional(),
  email,
  password: z.string()
    .min(10, "Use at least 10 characters.")
    .max(128, "Use at most 128 characters.")
    .refine((v) => v.trim() === v, "Remove spaces at the start or end.")
    .refine((v) => new Set(v).size >= 4, "Choose a less predictable password."),
  confirmPassword: z.string(),
  acknowledge: z.literal(true, { errorMap: () => ({ message: "Please confirm you understand this." }) }),
});

// A separate schema joined with z.intersection, so the match check runs even while
// other fields are invalid (object-level refinements are skipped in that case).
const passwordsMatch = z.object({ password: z.string(), confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords don't match." });

export const registerSchema = z.intersection(registerFields, passwordsMatch);
export type RegisterValues = z.infer<typeof registerSchema>;
