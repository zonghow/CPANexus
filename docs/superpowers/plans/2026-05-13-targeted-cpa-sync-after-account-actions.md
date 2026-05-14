# Targeted CPA Sync After Account Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After account enable/disable, delete, or move operations, refresh only the affected CPA instance data so the account management page shows the final remote-backed state immediately.

**Architecture:** Extract a reusable single-instance sync function from the existing full sync job. Account mutation routes will call it after successful remote mutations for the source CPA and, for moves, the target CPA. The scheduled full sync remains unchanged as the background safety net.

**Tech Stack:** Next.js route handlers, TypeScript, Drizzle ORM, SQLite, Vitest.

---

### Implementation Steps

**Files:**
- Modify: `src/lib/jobs.ts`
- Modify: `src/app/api/auth-files/[id]/route.ts`
- Modify: `src/app/api/auth-files/[id]/route.test.ts`

**Acceptance Criteria:**
- Disable/enable syncs only the source CPA after updating local status.
- Delete removes local records immediately and syncs only the source CPA afterward.
- Move syncs the source and target CPA after remote upload/delete and local move.
- If the targeted sync fails after the primary operation succeeded, the API still succeeds and reports sync failure details instead of rolling back the account operation.
- Existing full scheduled sync behavior remains unchanged.

**Test Commands:**
- `npm test -- 'src/app/api/auth-files/[id]/route.test.ts'`
- `npm test`
- `npm run lint`
- `npm run build`

- [x] Step 1: Add route tests that mock targeted sync and assert disable, delete, and move call it with the affected CPA instance ids.
- [x] Step 2: Run `npm test -- 'src/app/api/auth-files/[id]/route.test.ts'` and confirm the new tests fail because targeted sync is not wired yet.
- [x] Step 3: Export a `syncCpaInstanceById(cpaInstanceId: number)` helper from `src/lib/jobs.ts` by extracting the existing per-instance body of `syncCpaInstances`.
- [x] Step 4: Update `src/app/api/auth-files/[id]/route.ts` to call the helper after delete, enable/disable, and move operations; catch post-operation sync errors and include them in the JSON response.
- [x] Step 5: Run the targeted route test and confirm it passes.
- [x] Step 6: Run full verification: `npm test`, `npm run lint`, and `npm run build`.
