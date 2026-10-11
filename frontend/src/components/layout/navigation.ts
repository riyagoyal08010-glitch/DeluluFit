import { BarChart3, Home, Lightbulb, Soup, User, UtensilsCrossed, Wallet, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar (the rest are in the mobile menu drawer). */
  primary: boolean;
}

/** Single source of truth for app navigation (sidebar, bottom bar, drawer). */
export const NAV_ITEMS: NavItem[] = [
  { to: "/app", label: "Home", icon: Home, primary: true },
  { to: "/app/meals", label: "Meals", icon: UtensilsCrossed, primary: true },
  { to: "/app/nutrition", label: "Nutrition", icon: BarChart3, primary: false },
  { to: "/app/menu", label: "Mess menu", icon: Soup, primary: true },
  { to: "/app/budget", label: "Budget", icon: Wallet, primary: true },
  { to: "/app/suggestions", label: "Suggestions", icon: Lightbulb, primary: false },
  { to: "/app/profile", label: "Profile", icon: User, primary: true },
];
