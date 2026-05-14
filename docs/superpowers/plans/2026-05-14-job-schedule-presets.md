# Job Schedule Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw-only cron editing with compact human-friendly schedule controls, while keeping advanced cron available and simplifying the global sync countdown styling.

**Architecture:** Add a small cron preset parser/formatter in `src/lib` so the UI can convert between friendly schedules and the existing cron string stored by the backend. Update the jobs section to edit the parsed schedule and still submit `{ cron, enabled }` to the current API. Simplify the header countdown component to render muted text only.

**Tech Stack:** Next.js, React, TypeScript, Vitest, Tailwind, existing shadcn-style UI primitives.

---

### Implementation Steps

**Files:**
- Create: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/lib/cron-presets.ts`
- Create: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/lib/cron-presets.test.ts`
- Modify: `/Users/bytedance/Developer/github.com/ai-workspace/cpa-nexus/src/components/cpa-dashboard.tsx`

**Acceptance Criteria:**
- Common schedules can be configured without typing cron: every N minutes, hourly at minute N, daily at HH:mm, weekly at day + HH:mm.
- Unknown cron expressions remain editable through advanced mode and are not destroyed by opening the page.
- Saving a job still sends the existing cron string to `/api/jobs/[key]`.
- The global `同步 CPA 6:20` countdown renders as muted text with no icon, border, or background.

**Test Commands:**
- `npm test -- src/lib/cron-presets.test.ts src/lib/cron-next-run.test.ts`
- `npm run lint`

- [x] Step 1: Write failing tests for `cronToSimpleSchedule`, `simpleScheduleToCron`, and `describeSimpleSchedule`.
- [x] Step 2: Run `npm test -- src/lib/cron-presets.test.ts` and confirm it fails because `src/lib/cron-presets` does not exist yet.
- [x] Step 3: Implement the cron preset helper with validation and Chinese labels.
- [x] Step 4: Run `npm test -- src/lib/cron-presets.test.ts src/lib/cron-next-run.test.ts` and confirm tests pass.
- [x] Step 5: Update `JobsSection` to use friendly schedule controls and keep advanced cron fallback.
- [x] Step 6: Update `SyncCountdownPill` to render plain muted text without icon, border, or background.
- [x] Step 7: Run `npm run lint` and fix any lint issues introduced by the change.
