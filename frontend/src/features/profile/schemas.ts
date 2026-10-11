import { z } from "zod";

/**
 * Client-side checks mirror backend/app/schemas (profile.py, auth.py) so mistakes
 * are caught before sending; the server re-validates everything.
 */

function optionalDecimal(label: string, min: number, max: number, places: number) {
  const pattern = places === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${places}})?$`);
  return z.string().trim().refine((v) => v === "" || pattern.test(v),
    places === 0 ? `${label}: use whole numbers.` : `${label}: use numbers with at most ${places} decimal place.`)
    .refine((v) => v === "" || !pattern.test(v) || (Number(v) >= min && Number(v) <= max),
            `${label} must be between ${min} and ${max}.`);
}

export const profileSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a name.").max(80, "Use at most 80 characters."),
  dietaryPattern: z.enum(["no_preference", "vegetarian", "eggetarian", "non_vegetarian", "vegan", "jain"]),
  heightCm: optionalDecimal("Height", 50, 272, 1),
  weightKg: optionalDecimal("Weight", 20, 400, 1),
  activityLevel: z.enum(["", "sedentary", "light", "moderate", "active", "very_active"]),
  currency: z.string().regex(/^[A-Z]{3}$/, "Choose a currency."),
  timezone: z.string().min(1, "Choose a time zone."),
  institutionId: z.string(),
  hostelId: z.string(),
});
export type ProfileFormValues = z.infer<typeof profileSchema>;

export const MIN_SELF_SET_ENERGY = 1200;
const NUTRIENT_FIELDS = ["energyKcal", "proteinG", "carbohydrateG", "fatG", "fibreG"] as const;

export const targetSchema = z.object({
  source: z.enum(["self_set", "professional"]),
  // Targets are stored to one decimal place (NUMERIC(…, 1)); more would be rounded silently.
  energyKcal: optionalDecimal("Energy", 500, 8000, 1),
  proteinG: optionalDecimal("Protein", 0, 500, 1),
  carbohydrateG: optionalDecimal("Carbohydrate", 0, 1500, 1),
  fatG: optionalDecimal("Fat", 0, 400, 1),
  fibreG: optionalDecimal("Fibre", 0, 150, 1),
  effectiveFrom: z.string(),
  notes: z.string().max(300, "Use at most 300 characters."),
}).superRefine((v, ctx) => {
  if (NUTRIENT_FIELDS.every((f) => v[f].trim() === "")) {
    ctx.addIssue({ code: "custom", path: ["energyKcal"], message: "Enter at least one target value." });
  }
  if (v.source === "self_set" && v.energyKcal.trim() !== "" && Number(v.energyKcal) < MIN_SELF_SET_ENERGY) {
    ctx.addIssue({ code: "custom", path: ["energyKcal"],
                   message: `Self-set energy targets below ${MIN_SELF_SET_ENERGY} kcal aren't supported. If a qualified professional gave you this target, choose that source instead.` });
  }
});
export type TargetFormValues = z.infer<typeof targetSchema>;

const newPasswordFields = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z.string()
    .min(10, "Use at least 10 characters.")
    .max(128, "Use at most 128 characters.")
    .refine((v) => v.trim() === v, "Remove spaces at the start or end.")
    .refine((v) => new Set(v).size >= 4, "Choose a less predictable password."),
  confirmPassword: z.string(),
});
// Joined with an intersection so these checks run even while other fields are invalid.
const passwordRelations = z.object({ currentPassword: z.string(), newPassword: z.string(), confirmPassword: z.string() })
  .superRefine((v, ctx) => {
    if (v.newPassword !== v.confirmPassword) {
      ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords don't match." });
    }
    if (v.newPassword !== "" && v.newPassword === v.currentPassword) {
      ctx.addIssue({ code: "custom", path: ["newPassword"], message: "Choose a password you haven't just used." });
    }
  });
export const changePasswordSchema = z.intersection(newPasswordFields, passwordRelations);
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
