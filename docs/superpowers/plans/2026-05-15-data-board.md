# 数据看板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增数据看板页面，迁移 CPA 管理统计卡片，并用 Recharts 展示可筛选的历史趋势图。

**Architecture:** 新增 `dashboard_metric_snapshots` 表持久化每个 CPA 的聚合历史指标；同步成功后写入快照；`/api/data-board` 负责按启用 CPA 和用户选择聚合当前统计与历史序列；前端新增独立数据看板组件，使用 Recharts 渲染三张折线图。

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM, SQLite, Recharts, Vitest.

---

### Task 1: Dependencies and Data Model

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/db/schema.ts`
- Modify: `src/db/migrate.ts`

- [ ] Step 1: Install `recharts@3.8.1` with `npm install recharts@3.8.1`.
- [ ] Step 2: Add `dashboardMetricSnapshots` to `src/db/schema.ts` with fields `id`, `cpaInstanceId`, `accountCount`, `availableAccountCount`, `average5hRemainingPercent`, `averageWeekRemainingPercent`, `proxyCount`, `capturedAt`.
- [ ] Step 3: Add migration SQL for `dashboard_metric_snapshots` and indexes on `captured_at` and `(cpa_instance_id, captured_at)`.
- [ ] Step 4: Run `npm test -- src/db/migrate.test.ts` and confirm it passes.

### Task 2: Dashboard Metric Aggregation

**Files:**
- Create: `src/lib/data-board.ts`
- Create: `src/lib/data-board.test.ts`

- [ ] Step 1: Write failing tests for current metric aggregation with all enabled CPA instances and arbitrary selected CPA IDs.
- [ ] Step 2: Write failing tests for historical series aggregation using latest per-CPA snapshots at each captured time.
- [ ] Step 3: Implement `summarizeDataBoard`, `recordDashboardMetricSnapshot`, and `buildDataBoardSeries`.
- [ ] Step 4: Run `npm test -- src/lib/data-board.test.ts` and confirm it passes.

### Task 3: API and Sync Integration

**Files:**
- Create: `src/app/api/data-board/route.ts`
- Create: `src/app/api/data-board/route.test.ts`
- Modify: `src/lib/jobs.ts`

- [ ] Step 1: Write route tests for `GET /api/data-board` default all-enabled scope and selected CPA IDs.
- [ ] Step 2: Implement the route using `summarizeDataBoard` and `buildDataBoardSeries`.
- [ ] Step 3: Call `recordDashboardMetricSnapshot` after a CPA instance successfully refreshes quotas during sync.
- [ ] Step 4: Run `npm test -- src/app/api/data-board/route.test.ts src/lib/jobs.test.ts` and confirm it passes.

### Task 4: Frontend Page and Navigation

**Files:**
- Create: `src/components/data-board-section.tsx`
- Modify: `src/components/cpa-dashboard.tsx`
- Modify: `src/app/[section]/page.tsx`
- Modify: `src/app/page.tsx`

- [ ] Step 1: Add `dashboard` to route sections and make `/` redirect to `/dashboard`.
- [ ] Step 2: Add the sidebar item `数据看板` and remove stats props/cards from `InstancesSection`.
- [ ] Step 3: Implement `DataBoardSection` with all-enabled default, unlimited CPA checkboxes, five stat cards, and three Recharts line charts.
- [ ] Step 4: Ensure the global immediate sync flow refreshes the data board after `loadAll`.
- [ ] Step 5: Run `npm run lint` and fix any lint issues.

### Task 5: Final Verification

**Files:**
- All changed files

- [ ] Step 1: Run `npm test` and confirm all tests pass.
- [ ] Step 2: Run `npm run build` and confirm the production build succeeds.
- [ ] Step 3: Inspect `git diff --stat` and `git diff --check`.
- [ ] Step 4: Report changed files, verification results, and any deployment note.
