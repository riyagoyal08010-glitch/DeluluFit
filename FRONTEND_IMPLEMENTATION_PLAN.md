# DeluluFit frontend — implementation plan

Decisions are in `FRONTEND_DECISIONS.md`; verified status in
`FRONTEND_IMPLEMENTATION_STATUS.md`. Each step ships UI, typed API calls and
tests together; nothing is wired to an endpoint that hasn't been checked.

| # | Step | Depends on | Done when |
|---|---|---|---|
| 1 | Foundation: tooling, tokens, UI primitives, shell, navigation, API client | — | Builds, type-checks, tests pass (**done**) |
| 2 | Auth pages + session (real API), demo mode, dashboard (live + demo) | 1 | Login/register/sign-out against backend; dashboard empty/error/data states tested (**done**) |
| 3 | Onboarding wizard (profile, preferences, allergies, optional targets, budget, institution) | 2, backend profile API | Steps with back navigation, optional fields marked, data persisted via API, tests |
| 4 | Meal logging: food search → portion → review → save; history with edit/remove/add/delete | 2, backend meals/foods API | **Done** (live API, 16 tests). Quick-log of recent foods deferred: needs a backend endpoint |
| 5 | Nutrition page from `/nutrition/summary` (day history was done in step 4) | 4 | 7/30-day views, completeness indicators, provenance disclosure; demo trend replaced in live mode |
| 6 | Budget page from existing `/budget` endpoints | 2 | Set budget, add/edit expenses, refunds, filters, category breakdown; tests |
| 7 | Mess menu upload/review/confirm | backend menu API (not built) | Upload with validation and progress, review/correct, confirm, calendar |
| 8 | Suggestions | backend rules (not built) | Explainable, dismissible, persisted |
| 9 | Profile & settings, account deletion, privacy | 2 | Edit profile/preferences/allergies/targets; delete account with confirmation |
| 10 | End-to-end (Playwright) and accessibility pass | 3–9 | 16-step journey from the product brief; keyboard and screen-reader checks |
