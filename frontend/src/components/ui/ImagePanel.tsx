import type { ComponentType, ReactNode } from "react";

import { BowlIllustration, ChaiIllustration, CoinJarIllustration, ThaliIllustration } from "@/components/illustrations/Porcelain";
import { cn } from "@/lib/cn";

/**
 * Cinematic, image-led panel (the reference's large photo cards). DeluluFit has no
 * photography yet, so the "image" is an illustrated scene: cool slate-to-mist light
 * with a porcelain illustration. It is decorative and never implies what a student
 * ate or what a mess serves.
 *
 * Readability: a slate overlay sits under all text. On small screens it covers the
 * whole panel; from md up it fades out only past the text column. White text on it
 * measures ≥ 5:1 even over the lightest scene colour (see index.css / F30).
 */
export type Scene = "thali" | "bowl" | "chai" | "jar";
const ART: Record<Scene, ComponentType<{ className?: string }>> = {
  thali: ThaliIllustration, bowl: BowlIllustration, chai: ChaiIllustration, jar: CoinJarIllustration,
};

export function ImagePanel({ scene, children, className, artClassName, as: Tag = "section", ...rest }:
  { scene: Scene; children?: ReactNode; className?: string; artClassName?: string; as?: "section" | "div" } &
  Record<`aria-${string}`, string | boolean | undefined>) {
  const Art = ART[scene];
  return (
    <Tag className={cn("relative isolate overflow-hidden rounded-sheet text-white shadow-float", className)} {...rest}>
      {/* Scene: deep slate into misty blue, with a soft key light from the right. */}
      <div aria-hidden="true" className="absolute inset-0 -z-20"
           style={{ background: "radial-gradient(38rem 22rem at 82% 30%, rgb(255 255 255 / 0.45), transparent 62%), "
             + "linear-gradient(125deg, rgb(var(--color-action)) 0%, rgb(var(--color-accent-soft)) 58%, rgb(var(--color-accent-light)) 100%)" }} />
      <div aria-hidden="true"
           className={cn("pointer-events-none absolute -z-10 opacity-95 drop-shadow-[0_24px_40px_rgb(20_35_50/0.35)]",
                         "-bottom-6 -right-10 w-[78%] max-w-[26rem] sm:-right-6 md:bottom-auto md:right-4 md:top-1/2 md:w-[44%] md:-translate-y-1/2",
                         artClassName)}>
        <Art />
      </div>
      {/* Text overlay: full cover on mobile, a left-to-right fade from md. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[rgb(36_55_70/0.62)] md:bg-transparent
                                          md:bg-[linear-gradient(90deg,rgb(36_55_70/0.74)_0%,rgb(36_55_70/0.62)_48%,transparent_78%)]" />
      <div className="relative">{children}</div>
    </Tag>
  );
}

/** Frosted chip for metadata over imagery ("01.50 Hrs" in the reference). */
export function GlassChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("glass-dark inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium", className)}>
      {children}
    </span>
  );
}
