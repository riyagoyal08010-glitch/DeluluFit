import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useDataMode } from "@/features/auth/session";
import { budgetApi, mealsApi, profileApi } from "@/lib/api/endpoints";
import { localIsoDate } from "@/lib/format";
import { demoBudget, demoDay } from "@/mocks/demoData";
import type { BudgetSummary, DayMeals, ProfileBundle } from "@/types/api";

/**
 * Dashboard data. Live mode calls the API; demo mode returns sample data
 * through the same query interface so the UI cannot tell them apart in code,
 * while the page labels demo data explicitly. A failed live request is shown
 * as an error, never replaced by demo data.
 */
export function useDashboard(): {
  isDemo: boolean;
  profile: UseQueryResult<ProfileBundle>;
  today: UseQueryResult<DayMeals>;
  budget: UseQueryResult<BudgetSummary>;
} {
  const mode = useDataMode();
  const isDemo = mode === "demo";
  const date = localIsoDate();
  const profile = useQuery({
    queryKey: [mode, "profile"],
    queryFn: ({ signal }) => (isDemo ? Promise.resolve<ProfileBundle>({ profile: null }) : profileApi.get(signal)),
  });
  const today = useQuery({
    // Live: the server picks "today" in the profile timezone. Demo: the browser date.
    queryKey: [mode, "meals", "day", "today"],
    queryFn: ({ signal }) => (isDemo ? Promise.resolve(demoDay(date)) : mealsApi.day(undefined, signal)),
  });
  const budget = useQuery({
    queryKey: [mode, "budget", "summary"],
    queryFn: ({ signal }) => (isDemo ? Promise.resolve(demoBudget(date)) : budgetApi.summary({}, signal)),
  });
  return { isDemo, profile, today, budget };
}
