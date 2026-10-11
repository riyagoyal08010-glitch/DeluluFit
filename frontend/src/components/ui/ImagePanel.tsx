import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Inverse band: white type on black, with the iridescent ribbon (the one chromatic
 * material, F35) in its own column. The ribbon is decorative media: it never sits behind
 * text, so white-on-black contrast (21:1) holds everywhere. On small screens the ribbon
 * runs along the top of the band; from md it fills the right-hand column.
 *
 * `scene` only shifts the ribbon's drift so neighbouring bands don't move in step;
 * no picture is implied of what anyone ate or what a mess serves.
 */
export type Scene = "thali" | "bowl" | "chai" | "jar";
const PHASE: Record<Scene, string> = { thali: "0s", bowl: "-6s", chai: "-11s", jar: "-15s" };

export function ImagePanel({ scene, children, className, artClassName, as: Tag = "section", ...rest }:
  { scene: Scene; children?: ReactNode; className?: string; artClassName?: string; as?: "section" | "div" } &
  Record<`aria-${string}`, string | boolean | undefined>) {
  return (
    <Tag className={cn("relative flex flex-col overflow-hidden rounded-card bg-black text-white shadow-float md:flex-row", className)} {...rest}>
      <div aria-hidden="true"
           className={cn("iridescent h-20 shrink-0 md:order-last md:h-auto md:w-[34%]", artClassName)}
           style={{ "--ribbon-phase": PHASE[scene] } as CSSProperties} />
      <div className="relative min-w-0 flex-1">{children}</div>
    </Tag>
  );
}

/** Small outlined chip for metadata on an inverse band. */
export function GlassChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-white/40 px-3 py-1 text-xs",
                        className)}>
      {children}
    </span>
  );
}
