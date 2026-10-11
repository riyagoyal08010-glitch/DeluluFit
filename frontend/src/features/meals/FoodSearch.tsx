import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { PenLine, Search, Soup } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Badge, ErrorState, LoadingState } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Field";
import { ApiError } from "@/lib/api/client";
import { foodsApi } from "@/lib/api/endpoints";
import { liveKeys } from "@/lib/api/queryKeys";
import type { FoodSearchHit } from "@/types/api";

import { useDebouncedValue } from "./portion";

export const SEARCH_DEBOUNCE_MS = 300;

const DIET_LABELS: Record<string, string> = {
  vegan: "Vegan", vegetarian: "Vegetarian", eggetarian: "Contains egg", non_vegetarian: "Non-veg", unknown: "",
};

function matchNote(hit: FoodSearchHit): string | null {
  if (hit.match_kind === "fuzzy") return `Similar spelling to “${hit.matched_name}”`;
  if (hit.matched_name !== hit.canonical_name.toLowerCase() && hit.match_kind !== "words") {
    return `Matched “${hit.matched_name}”`;
  }
  return null;
}

/**
 * Search the reference food list. Results come only from the API; if nothing
 * fits, the student can log the dish by name with its nutrition left unknown.
 */
export function FoodSearch({ onSelect, onManual, autoFocus = false }:
  { onSelect: (hit: FoodSearchHit) => void; onManual: (name: string) => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const statusId = useId();
  const query = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const search = useQuery({
    queryKey: liveKeys.foodSearch(query),
    // The signal cancels the request when a newer search replaces it.
    queryFn: ({ signal }) => foodsApi.search(query, signal),
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
  const typing = text.trim() !== query;
  const results = search.data?.results ?? [];
  const showingFor = search.data?.query;
  const stale = typing || search.isPlaceholderData;

  return (
    <div className="space-y-3">
      <Input label="Search foods" type="search" value={text} autoFocus={autoFocus} autoComplete="off"
             placeholder="e.g. roti, dal, idli, chai" maxLength={80} aria-describedby={statusId}
             onChange={(e) => setText(e.target.value)}
             trailing={<Search className="mr-2 h-4 w-4 text-ink-muted" aria-hidden="true" />} />
      <div id={statusId} aria-live="polite" className="sr-only">
        {query && search.isSuccess && !stale ? `${results.length} results for ${query}` : ""}
      </div>

      {!query ? (
        <p className="text-sm text-ink-muted">Type a food name. Common Indian and hostel names are included.</p>
      ) : search.isError && !stale ? (
        <ErrorState title="Search failed"
                    message={search.error instanceof ApiError ? search.error.message : "Please try again."}
                    onRetry={() => search.refetch()} />
      ) : search.isPending ? (
        <LoadingState label="Searching" />
      ) : (
        <div className={stale ? "opacity-60 transition-opacity" : undefined} aria-busy={stale || search.isFetching}>
          {showingFor && showingFor !== query && <p className="mb-2 text-xs text-ink-muted">Showing results for “{showingFor}”…</p>}
          {results.length === 0 ? (
            <p className="rounded-control border border-line/70 bg-sheet p-3 text-sm text-ink-muted">
              No foods match “{showingFor}”.
            </p>
          ) : (
            <ul className="divide-y divide-line/70 overflow-hidden rounded-control border border-line/70" aria-label="Search results">
              {results.map((hit) => {
                const note = matchNote(hit);
                return (
                  <li key={hit.id}>
                    <button type="button" onClick={() => onSelect(hit)}
                            className="flex min-h-[56px] w-full items-center justify-between gap-3 bg-surface px-3 py-2.5
                                       text-left hover:bg-surface-raised focus-visible:shadow-focus">
                      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-accent-tint/70">
                        <Soup className="h-5 w-5 text-accent" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{hit.canonical_name}</span>
                        <span className="block truncate text-xs text-ink-muted">
                          {[note, hit.category, DIET_LABELS[hit.diet_type]].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {(hit.alias_confidence === "LOW" || hit.match_kind === "fuzzy") &&
                        <Badge tone="warning">Check this is right</Badge>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {showingFor && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => onManual(text.trim() || showingFor)}
                    icon={<PenLine className="h-4 w-4" aria-hidden="true" />}>
              Not listed? Log “{text.trim() || showingFor}” without nutrition data
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
