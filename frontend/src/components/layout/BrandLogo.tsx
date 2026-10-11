import logo from "@/assets/brand/delulu-logo.webp";
import logoSmall from "@/assets/brand/delulu-logo-640.webp";
import { cn } from "@/lib/cn";

/**
 * The full DeluluFit logo (the owner's artwork: DELULU behind a glass "Mess & Macros" plate),
 * used wherever the brand is shown large. Never recoloured or redrawn; sharp corners like every
 * image in the app. Pass `decorative` when the page already names the brand nearby.
 */
export function BrandLogo({ className, decorative = false, priority = false }:
  { className?: string; decorative?: boolean; priority?: boolean }) {
  return (
    <img src={logo} srcSet={`${logoSmall} 640w, ${logo} 1093w`}
         sizes="(min-width: 1024px) 34vw, 100vw" width={1093} height={873}
         alt={decorative ? "" : "DeluluFit logo: Delulu, Mess & Macros"}
         aria-hidden={decorative || undefined}
         loading={priority ? "eager" : "lazy"} decoding="async"
         className={cn("block h-auto w-full select-none", className)} />
  );
}
