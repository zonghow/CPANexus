# Message Push History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add paginated message push delivery history below the existing message push policy table.

**Architecture:** Reuse the existing `message_push_deliveries` audit table. Add an authenticated read-only API that joins deliveries with policy and CPA names, then render a compact paginated table in `MessagePushSection`.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, SQLite, shadcn/ui, Tailwind, Sonner, Vitest.

---

### Implementation Steps

**Files:**
- Create: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/app/api/message-push-deliveries/route.ts`
- Create: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/app/api/message-push-deliveries/route.test.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/components/message-push-section.tsx`

**Acceptance Criteria:**
- `/api/message-push-deliveries` requires login.
- The API returns deliveries ordered by newest first with `page`, `pageSize`, `total`, and `totalPages`.
- Each history row includes policy name, CPA name, trigger key, status, message, response status, response body/error, and sent time.
- The message push page shows a “推送历史” table under the policy table with previous/next pagination.
- Success/error states are visually distinguishable.

**Test Commands:**
- `npm test -- src/app/api/message-push-deliveries/route.test.ts --testTimeout=30000`
- `npm run lint`
- `npm test -- --testTimeout=30000`
- `npm run build`

- [x] Step 1: Write route tests for authentication, pagination, ordering, and joined names.
- [x] Step 2: Run the new route test and confirm it fails because the route is missing.
- [x] Step 3: Implement `/api/message-push-deliveries`.
- [x] Step 4: Run the route test and confirm it passes.
- [x] Step 5: Add delivery history types, fetch state, pagination state, and render the table under policies.
- [x] Step 6: Run lint, full tests, and production build.
