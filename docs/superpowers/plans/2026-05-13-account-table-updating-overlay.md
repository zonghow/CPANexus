# Account Table Updating Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a spin loading overlay on each CPA account table that is currently being updated by account actions.

**Architecture:** Track a set of updating CPA instance ids in `CpaDashboard` and pass it into `AccountsSection`. Account actions mark the affected CPA ids before the API call and clear them after the API call plus reload completes. Each CPA table card renders a local overlay when its id is in the updating set.

**Tech Stack:** Next.js client component, React state, Tailwind CSS, lucide-react `Loader2`.

---

### Implementation Steps

**Files:**
- Modify: `src/components/cpa-dashboard.tsx`

**Acceptance Criteria:**
- Delete, enable, and disable actions show the overlay only on the source CPA table.
- Move action shows the overlay on both source and target CPA tables.
- Quick and manual replenishment show the overlay on the target CPA table.
- Overlay blocks table interaction while the affected CPA is updating but does not block unrelated CPA tables.
- Full page initial loading remains unchanged.

**Test Commands:**
- `npm run lint`
- `npm run build`

- [x] Step 1: Add `updatingCpaIds` state plus helper functions in `CpaDashboard` to mark and clear affected CPA ids.
- [x] Step 2: Update account action handlers to compute affected CPA ids, wrap mutate/loadAll in the updating helper, and preserve existing messages.
- [x] Step 3: Pass `updatingCpaIds` to `AccountsSection` and render a per-table overlay with `Loader2` and “正在更新”.
- [x] Step 4: Run `npm run lint` and `npm run build`.
