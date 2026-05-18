# Message Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable Webhook message push policies with CPA monitoring scope, dedupe until recovery, and a sidebar page for create/edit/delete/enable/disable.

**Architecture:** Persist push policies, scoped CPA links, dedupe state, and delivery audit rows in SQLite/Drizzle. Evaluate enabled policies after each CPA quota sync, computing per-CPA exception and remaining-quota snapshots, rendering the body template, and sending Webhook only when a condition first becomes active. Provide authenticated API routes for policy CRUD and a compact shadcn UI page reachable from the sidebar.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, SQLite, shadcn/ui, Tailwind, Sonner, Vitest.

---

### Task 1: Schema And Migration

**Files:**
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/db/schema.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/db/migrate.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/db/migrate.test.ts`

- [x] **Step 1: Add Drizzle tables**

Add tables:
- `message_push_policies`: `id`, `name`, `trigger_type`, nullable `threshold_percent`, `scope_type`, `webhook_url`, `headers_json`, `body_template`, boolean `enabled`, `created_at`, `updated_at`.
- `message_push_policy_cpa_instances`: `policy_id`, `cpa_instance_id`, composite primary key, cascading deletes.
- `message_push_states`: `id`, `policy_id`, `cpa_instance_id`, `trigger_key`, boolean `active`, `activated_at`, `recovered_at`, `last_sent_at`, nullable `last_value`, nullable `last_message`, unique `(policy_id, cpa_instance_id, trigger_key)`.
- `message_push_deliveries`: `id`, `policy_id`, `cpa_instance_id`, `trigger_key`, `status`, `message`, nullable `response_status`, nullable `response_body`, nullable `error`, `sent_at`.

- [x] **Step 2: Add manual migration SQL**

Create the same four tables and indexes in `migrate()`. Add indexes for policy links by CPA and delivery/state lookup:
- `message_push_policy_cpa_instances_cpa_idx`
- `message_push_states_unique`
- `message_push_deliveries_policy_time_idx`

- [x] **Step 3: Extend migration tests**

Add a test that runs `migrate()` and verifies all four tables exist with representative columns and the state unique index exists.

- [x] **Step 4: Run migration test**

Run: `npm test -- src/db/migrate.test.ts --testTimeout=30000`

Expected: PASS.

### Task 2: Message Push Evaluation Library

**Files:**
- Create: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/lib/message-push.ts`
- Create: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/lib/message-push.test.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/lib/jobs.ts`

- [x] **Step 1: Write tests for quota threshold dedupe**

Test case: one enabled CPA has two quota snapshots with 5h usages `80` and `90`, so 5h remaining average is `15`. A policy `remaining_5h_below` with threshold `20` sends once on first evaluation, does not send on second evaluation while still below threshold, recovers when remaining rises to `50`, and sends again when remaining drops below threshold.

- [x] **Step 2: Write tests for account exception and custom scope**

Test case: two enabled CPAs exist, a custom-scope `account_exception` policy links only CPA A, CPA A has one active unavailable auth file with status/exception text, CPA B has an exception too, and only CPA A sends. Verify the rendered body includes `{{msg}}`, `{{cpaName}}`, and `{{accountCount}}`.

- [x] **Step 3: Implement evaluation helpers**

In `src/lib/message-push.ts`, export:
- `messagePushTriggerTypes = ["account_exception", "remaining_5h_below", "remaining_week_below"] as const`
- `messagePushScopeTypes = ["all_enabled", "custom"] as const`
- `evaluateMessagePushPoliciesForCpa(cpaInstanceId: number): Promise<void>`
- `renderMessagePushTemplate(template, vars)`

Compute CPA snapshot from current DB rows:
- Active account count excludes disabled auth files.
- Exception count uses non-disabled auth files where `available === false` and either `status === "异常"` or `statusMessage` is present.
- 5h/week remaining uses per-account `100 - usage` clamped to `0..100`, averaged and rounded.

- [x] **Step 4: Implement send, state, and recovery**

For each matching enabled policy:
- If condition is active and no active state row exists, render body and send `fetch(webhookUrl, { method: "POST", headers, body })`.
- Record success/error in `message_push_deliveries`.
- Upsert `message_push_states` to `active = true` with `last_sent_at`, `last_value`, `last_message`.
- If condition is inactive and state is active, mark `active = false` and set `recovered_at`.
- Catch webhook errors inside the library so CPA sync still completes.

- [x] **Step 5: Hook evaluator into sync**

In `performCpaInstanceSync`, call `evaluateMessagePushPoliciesForCpa(instance.id)` after `recordDashboardMetricSnapshot(instance.id, ...)`.

- [x] **Step 6: Run library tests**

Run: `npm test -- src/lib/message-push.test.ts --testTimeout=30000`

Expected: PASS.

### Task 3: Message Push API

**Files:**
- Create: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/app/api/message-push-policies/route.ts`
- Create: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/app/api/message-push-policies/[id]/route.ts`
- Create: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/app/api/message-push-policies/route.test.ts`

- [x] **Step 1: Write route tests**

Cover:
- unauthenticated request returns `401`;
- `POST` creates policy with custom CPA scope links;
- `GET` returns policies including `cpaInstanceIds` and `instances`;
- `PUT` updates enabled, threshold, template, and scope links;
- `DELETE` removes policy and links.

- [x] **Step 2: Implement shared validation in the collection route**

Use zod to require:
- `name` non-empty;
- `triggerType` one of the three trigger types;
- `thresholdPercent` number `0..100` for remaining-threshold triggers and `null` for account-exception;
- `scopeType` `all_enabled` or `custom`;
- `cpaInstanceIds` positive integer array, non-empty when scope is custom;
- `webhookUrl` URL;
- `headersJson` valid JSON object string;
- `bodyTemplate` non-empty.

- [x] **Step 3: Implement GET and POST**

GET returns `{ policies, instances }`; each policy includes `cpaInstanceIds`. POST inserts the policy and replaces scope links.

- [x] **Step 4: Implement PUT and DELETE**

PUT updates a policy and replaces scope links. DELETE deletes the policy; cascading removes links/states/deliveries.

- [x] **Step 5: Run API tests**

Run: `npm test -- src/app/api/message-push-policies/route.test.ts --testTimeout=30000`

Expected: PASS.

### Task 4: Sidebar Page And Form UI

**Files:**
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/app/[section]/page.tsx`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/components/cpa-dashboard.tsx`
- Create: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/components/message-push-section.tsx`

- [x] **Step 1: Add route and nav entry**

Add section id `message-push`, sidebar label `消息推送`, and a Bell/Send icon. Whitelist the route in `[section]/page.tsx`.

- [x] **Step 2: Create `MessagePushSection`**

The component fetches `/api/message-push-policies`, shows a compact table with columns `名称`, `推送时机`, `监控范围`, `Webhook`, `启用`, `更新`, `操作`, and uses Sonner toasts for success/error.

- [x] **Step 3: Add create/edit modal form**

Fields:
- 名称
- 推送时机 select: `有账号出现异常`, `5h剩余低于`, `周剩余低于`
- 阈值 percent input only for remaining triggers
- 监控范围 radio/select: `全部启用 CPA` or `自定义 CPA`
- 自定义 CPA checkboxes when custom
- Webhook URL
- 请求头 JSON textarea
- 请求体模板 textarea with helper text listing supported variables

- [x] **Step 4: Add delete and enable/disable controls**

Use `Switch` for enabled state and a delete action with browser confirm or existing dialog pattern. On create/update/delete/toggle, reload policies and toast the result.

- [x] **Step 5: Run frontend validation**

Run: `npm run lint`

Expected: PASS.

### Task 5: Full Verification

**Files:**
- Review all changed files from Tasks 1-4.

- [x] **Step 1: Run targeted test group**

Run: `npm test -- src/db/migrate.test.ts src/lib/message-push.test.ts src/app/api/message-push-policies/route.test.ts --testTimeout=30000`

Expected: PASS.

- [x] **Step 2: Run full test suite**

Run: `npm test -- --testTimeout=30000`

Expected: PASS.

- [x] **Step 3: Run production build**

Run: `npm run build`

Expected: PASS.

- [x] **Step 4: Inline final review**

Inspect `git diff --stat` and `git diff` for unrelated changes, missing validation, or accidental alert UI.
