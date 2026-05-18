# Browser Notification Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add “浏览器通知” as a message push type that works while the Nexus page is open.

**Architecture:** Add a delivery type to push policies and delivery history. Webhook policies keep the current outbound HTTP behavior; browser-notification policies record a delivery event without calling external HTTP. The frontend polls recent delivery history while open and uses the browser Notification API for new browser-notification deliveries after the user grants permission.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, SQLite, shadcn/ui, Tailwind, Sonner, Vitest.

---

### Implementation Steps

**Files:**
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/db/schema.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/db/migrate.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/db/migrate.test.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/lib/message-push.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/lib/message-push.test.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/app/api/message-push-policies/route.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/app/api/message-push-policies/route.test.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/app/api/message-push-deliveries/route.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/app/api/message-push-deliveries/route.test.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/components/message-push-section.tsx`

**Acceptance Criteria:**
- Message push policies support `webhook` and `browser_notification` delivery types.
- Existing policies default to `webhook` after migration.
- Browser-notification policies do not require webhook URL or request headers.
- Browser-notification trigger evaluation creates a delivery history row and does not call `fetch`.
- The message push page lets users choose “Webhook” or “浏览器通知”.
- When the page is open and browser notification permission is granted, new browser-notification delivery rows produce native browser notifications.
- Delivery history shows the delivery type.

**Test Commands:**
- `npm test -- src/db/migrate.test.ts src/lib/message-push.test.ts src/app/api/message-push-policies/route.test.ts src/app/api/message-push-deliveries/route.test.ts --testTimeout=30000`
- `npm run lint`
- `npm test -- --testTimeout=30000`
- `npm run build`

- [x] Step 1: Add failing tests for migration columns, browser-notification policy validation, browser delivery evaluation, and delivery history type.
- [x] Step 2: Add schema and migration support for `delivery_type`.
- [x] Step 3: Update policy API validation and serialization for `deliveryType`.
- [x] Step 4: Update message push evaluation to branch webhook vs browser notification.
- [x] Step 5: Update delivery history API to return `deliveryType`.
- [x] Step 6: Update the message push UI for delivery type selection and browser notification polling.
- [x] Step 7: Run targeted tests, lint, full tests, and production build.
