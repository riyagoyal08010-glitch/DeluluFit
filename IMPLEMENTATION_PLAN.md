# DeluluFit — implementation plan

Order follows the product brief. Each phase lists its dependencies, acceptance
criteria and the tests that prove them. Status lives in
`IMPLEMENTATION_STATUS.md`; rationale in `DECISIONS.md`.

**Adjustment to the brief's order:** Phase 3 (auth/profile) was verified
before Phase 2's changes because it was already implemented. Mess-fee
accounting is moved from onboarding (Phase 3) to the budget phase (8), where
the accounting rule is defined.

| # | Phase | Depends on | Acceptance criteria | Tests |
|---|---|---|---|---|
| 1 | Verify foundation | — | App imports and starts; migrations up/down/up on a disposable DB; models match migrations (columns, constraints, indexes); existing tests recorded | `test_migrations.py`, `test_db_integrity.py`, `test_api_health.py` |
| 2 | Food data & nutrition engine | 1 | Deterministic matching/search incl. ambiguity, fuzzy and no-match; portion conversion without ml=g or invented portions; exact arithmetic, display-only rounding; reported zero vs unknown vs not-in-source vs no-estimate; incomplete totals; provenance + versioned history; dataset validated | `test_nutrition_*.py`, `test_food_seed.py` |
| 3 | Auth, profile, onboarding, targets | 1 | Register/login/logout/session/expiry/CSRF/rate limit/deletion; profile and onboarding with optional fields; target sources stored with dates; client cannot mislabel a reference estimate | `test_api_auth.py`, `test_api_profile.py` |
| 4 | Meal-logging API | 2, 3 | Search/detail/match foods; meal + item CRUD in transactions; versioned estimates on edit; day history; range summaries (7/30 days, consistent boundaries); idempotency; pagination; cross-user isolation | `test_api_meals.py` |
| 5 | Food entry & manual fallback | 4 | Manual items logged with unknown nutrition (done in 4). **Remaining:** private user-created foods with ownership rules, never treated as verified global data | API tests for private foods incl. cross-user |
| 6 | Frontend foundation | 3 | React + TS + Vite + Tailwind 3.4 + React Router; design tokens (palette in brief); AppShell, navigation, typed API client (credentials, CSRF, error normalization); login/register; onboarding wizard | Vitest + Testing Library; `npm run build`; type check |
| 7 | Dashboard, meal logging, history, nutrition UI | 4, 6 | Real API data only; quick log; search → quantity/unit → review → save; edit/delete; completeness indicators; source disclosures | Component + workflow tests; Playwright happy path |
| 8 | Budget UI (+ mess-fee rule) | existing budget API, 6 | Budget overview, expenses, refunds, filters, category breakdown; documented mess-fee accounting (no double counting) | Budget API tests (exist), UI workflow tests |
| 9 | Menu upload, extraction, review, versioning | 6, storage | Private storage; type/size/pixel validation; provider interface with honest failure and manual fallback; review/correct/confirm; confirmed versions immutable (triggers exist) | Upload validation, provider-error, review/confirm, cross-user tests |
| 10 | Menu → meal flow | 4, 9 | Confirmed menu item pre-fills a meal item; student confirms portion; meal independent of later menu edits | API + UI tests |
| 11 | Analytics & recommendations | 4, 8, 9 | Charts from API data with accessible summaries; deterministic, explainable, dismissible recommendations; allergy caution | Rule unit tests, API tests |
| 12 | Profile/settings, privacy, accessibility | 6–11 | Settings pages, deletion flow, privacy notes, WCAG 2.2 AA checks | a11y checks, UI tests |
| 13 | Integration & deployment readiness | all | E2E journey (16 steps in brief), security review, production builds, deployment docs; no paid resources without approval | Playwright E2E, full suites |

## Phase 4 endpoint contract (implemented)

See `docs/API.md`.

## Open items that need the product owner

None blocking. Decisions made without asking are recorded in `DECISIONS.md`
(notably D9 no silent matching, D12 dates, D13 money/consumption separation,
D14 reference estimates, D16 empty meals).
