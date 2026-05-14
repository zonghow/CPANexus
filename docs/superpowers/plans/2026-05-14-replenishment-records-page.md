# Replenishment Records Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated replenishment records table and a new page for viewing manual, quick, and automatic replenishment attempts.

**Architecture:** Store replenishment audit rows in a new `replenishment_records` SQLite table, with snapshot fields for CPA name, account email, auth file name, source, status, reason codes, and errors. Write records from the existing manual/quick and automatic replenishment flows, expose them through `GET /api/replenishment-records`, and add a compact dashboard page reachable from the sidebar.

**Tech Stack:** Next.js route handlers, TypeScript, Drizzle ORM, SQLite, React, Tailwind CSS, lucide-react icons, Vitest.

---

### Implementation Steps

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/migrate.ts`
- Modify: `src/lib/jobs.ts`
- Modify: `src/app/api/cpa-instances/[id]/replenish/route.test.ts`
- Create: `src/app/api/replenishment-records/route.ts`
- Create: `src/app/api/replenishment-records/route.test.ts`
- Create: `src/lib/jobs.test.ts`
- Modify: `src/components/cpa-dashboard.tsx`
- Modify: `src/app/[section]/page.tsx`

**Acceptance Criteria:**
- `migrate()` creates `replenishment_records` and an index for newest-first reads.
- Quick, manual, and automatic replenishment successes create success records with CPA, email, file name, and source.
- Replenishment failures create error records when a target CPA can be resolved.
- `/api/replenishment-records` returns the newest records.
- The sidebar has a “补号记录” route, and refreshing that page stays on the same route.
- The records page displays time, source, CPA, email, file name, status, reason codes, and error.

**Test Commands:**
- `npm test -- 'src/app/api/cpa-instances/[id]/replenish/route.test.ts'`
- `npm test -- src/lib/jobs.test.ts`
- `npm test -- src/app/api/replenishment-records/route.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`

- [x] Step 1: Add failing tests for quick/manual replenish record creation in `src/app/api/cpa-instances/[id]/replenish/route.test.ts`.
- [x] Step 2: Add a failing automatic replenish test in `src/lib/jobs.test.ts`.
- [x] Step 3: Add a failing API route test for `GET /api/replenishment-records`.
- [x] Step 4: Add the Drizzle schema and migration SQL for `replenishment_records`.
- [x] Step 5: Implement record-writing helpers and call them from quick/manual and automatic replenishment flows.
- [x] Step 6: Implement `GET /api/replenishment-records`.
- [x] Step 7: Add the sidebar route, route whitelist, fetch state, and compact records table UI.
- [x] Step 8: Run targeted tests, then full tests, lint, and build.
