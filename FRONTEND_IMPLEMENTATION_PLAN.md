# DeluluFit frontend — implementation plan

Decisions are in `FRONTEND_DECISIONS.md`; verified status in
`FRONTEND_IMPLEMENTATION_STATUS.md`. Each step ships UI, typed API calls and
tests together; nothing is wired to an endpoint that hasn't been checked.

| # | Step | Depends on | Done when |
|---|---|---|---|
| 1 | Foundation: tooling, tokens, UI primitives, shell, navigation, API client | — | Builds, type-checks, tests pass (**done**) |
| 2 | Auth pages + session (real API), demo mode, dashboard (live + demo) | 1 | Login/register/sign-out against backend; dashboard empty/error/data states tested (**done**) |
| 3 | Onboarding wizard (profile, preferences, allergies, optional targets, budget, institution) | 2, backend profile API | **Done** (F34; live API, 14 tests): six steps reusing the Profile & settings and budget editors; per-step saving with `onboarding_step` progress; resume after refresh; completion via `complete-onboarding`; register → setup, incomplete sign-in → setup with "Finish later"; demo isolated. Not visually checked in a browser |
| 4 | Meal logging: food search → portion → review → save; history with edit/remove/add/delete | 2, backend meals/foods API | **Done** (live API, 16 tests). Quick-log of recent foods deferred: needs a backend endpoint |
| 5 | Nutrition page from `/meals/day`, `/nutrition/summary`, `/targets` | 4 | **Done** (live API, 13 tests): day view with all nutrient totals, sources, per-meal energy and target comparison; 7/30-day totals with chart + table. Custom ranges and target editing deferred |
| 6 | Budget page from existing `/budget` endpoints | 2 | **Done** (live API, 19 tests): overview with period navigation, transactions (add / refund / edit / delete, meal link), last 14 days, budget set / change / end / history. Kind/category filters unsupported by the API |
| 7 | Mess menu upload/review/confirm | backend menu API (not built) | Upload with validation and progress, review/correct, confirm, calendar |
| 8 | Suggestions | backend `GET /menus/{id}/suggestions` (uncommitted, menu session), 4, 7 | **Done** (F37; live API, 18 tests): date picker, menus for the date, meal tabs in the URL, fixed sections with reasons/cautions, allergy notice, reference nutrition statuses, prices only when printed, "Log this" → meal logger prefill with explicit save; demo fixture through the same cards. Dismissal/persistence not built (no backend). Usable by real accounts only once step 7 can confirm a menu. Not visually checked in a browser |
| 9 | Profile & settings, account deletion, privacy | 2 | **Done** (live API, 22 tests): profile (full-replacement save), preferences, allergies, targets with provenance and history, change password, sign out, account deletion with cache clearing. College/hostel creation and data export not built |
| R | Light editorial redesign (all pages) | 1–9 | Done, then superseded by G (F29 → F30) |
| G | Premium glass redesign (all pages) | R | **Done** (F30): glass tokens and variants, Inter, ImagePanel, DayStrip, glass shell with floating bottom nav; Dashboard, Meals, Nutrition, Budget, Profile, Login/Register, Landing, Not found, Menu, Suggestions migrated; 107 tests, type-check, build and contrast audit pass. **Not visually checked in a browser** (no browser tool available) |
| O | Deep-ocean theme (F32) | G | **Done**: dark ocean tokens, glass levels, Manrope headings + Inter body, controls, focus, nav, charts; contrast audit passes (worst text pair 5.08:1). Not visually checked in a browser |
| T | Editorial serif typography (F33) | O | **Done**: Playfair Display (display) + Newsreader (body) as open alternatives to Sage/Amor; tokens, lining/tabular figures, metric-matched fallbacks. Not visually checked in a browser |
| P | Four-colour palette (F34) | O | **Done**: #06141B, #11212D, #CCD0CF, white only; status by wording/icons; Tailwind default colours overridden; 121 tests, type-check, build and contrast audit pass. Not visually checked in a browser |
| 10 | End-to-end (Playwright) and accessibility pass | 3–9 | 16-step journey from the product brief; keyboard and screen-reader checks |
