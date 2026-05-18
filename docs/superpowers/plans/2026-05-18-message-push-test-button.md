# Message Push Test Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a test button for each message push policy and request browser notification permission when saving policies that include browser notifications.

**Architecture:** Add a dedicated authenticated `POST /api/message-push-policies/[id]/test` route that sends fixed template variables through the same delivery channels without threshold checks or dedupe state updates. Reuse the delivery recording path so test sends appear in push history. In the UI, add a per-row test button and request browser notification permission during save when the selected delivery types include browser notification.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, SQLite, shadcn/ui, Tailwind, Sonner, Vitest.

---

### Implementation Steps

**Files:**
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/lib/message-push.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/lib/message-push.test.ts`
- Create: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/app/api/message-push-policies/[id]/test/route.ts`
- Create: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/app/api/message-push-policies/[id]/test/route.test.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/components/message-push-section.tsx`

**Acceptance Criteria:**
- Each message push policy row has a `测试` button.
- Test sends use fixed vars: `msg=这是一条测试消息`, `trigger=测试推送`, `cpaName=测试CPA`, `value=10`, `threshold=20`, `accountCount=52`.
- Test sends skip trigger conditions and dedupe state.
- Test sends write delivery history rows for every selected delivery type.
- Browser notification permission is requested during save when the policy includes `浏览器通知`.
- Targeted tests, lint, full tests, and build pass.

**Test Commands:**
- `npm test -- src/lib/message-push.test.ts src/app/api/message-push-policies/[id]/test/route.test.ts --testTimeout=30000`
- `npm run lint`
- `npm test -- --testTimeout=30000`
- `npm run build`

- [x] Step 1: Write failing tests for direct test sending and the test route.
- [x] Step 2: Implement reusable test send function in `message-push.ts`.
- [x] Step 3: Implement `POST /api/message-push-policies/[id]/test`.
- [x] Step 4: Add `测试` button and loading state in the message push page.
- [x] Step 5: Request browser notification permission when saving browser-notification policies.
- [x] Step 6: Run targeted tests, lint, full tests, and build.
