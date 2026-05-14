# Per CPA Refresh Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a refresh button to every CPA account table that syncs only that CPA instance.

**Architecture:** Add a `POST /api/cpa-instances/[id]/sync` route that wraps `syncCpaInstanceById`. In the account management UI, pass an `onRefreshCpa` callback to each CPA card, reuse `updatingCpaIds` for the local overlay, and reload data when the targeted sync completes.

**Tech Stack:** Next.js route handlers, TypeScript, React state, Tailwind CSS, lucide-react icons, Vitest.

---

### Implementation Steps

**Files:**
- Create: `src/app/api/cpa-instances/[id]/sync/route.ts`
- Create: `src/app/api/cpa-instances/[id]/sync/route.test.ts`
- Modify: `src/components/cpa-dashboard.tsx`

**Acceptance Criteria:**
- Each CPA table header has a compact refresh icon button.
- Clicking it calls `POST /api/cpa-instances/[id]/sync`.
- Only the clicked CPA table shows the existing updating overlay while the request and reload are running.
- The existing global “立即同步” behavior is unchanged.

**Test Commands:**
- `npm test -- 'src/app/api/cpa-instances/[id]/sync/route.test.ts'`
- `npm run lint`
- `npm run build`
- `npm test`

- [x] Step 1: Add a failing route test for `POST /api/cpa-instances/[id]/sync`.
- [x] Step 2: Implement the route by calling `syncCpaInstanceById`.
- [x] Step 3: Add `refreshCpaInstance` in `CpaDashboard` using `withUpdatingCpaTables`.
- [x] Step 4: Pass `onRefreshCpa` into `AuthFilesSection` and render a compact refresh icon button in each CPA table header.
- [x] Step 5: Run targeted test, lint, build, and full tests.
