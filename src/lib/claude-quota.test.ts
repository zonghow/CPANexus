import { describe, expect, it } from "vitest";

import {
  buildClaudeUsageSummary,
  claudeUsageToQuotaPercents,
  parseClaudeUsagePayload,
  resolveClaudePlanLabel,
} from "./claude-quota";

describe("claude-quota", () => {
  it("builds a usage summary from the oauth usage payload", () => {
    const payload = parseClaudeUsagePayload(
      JSON.stringify({
        five_hour: { utilization: 35, resets_at: "2026-07-01T05:00:00Z" },
        seven_day: { utilization: 60, resets_at: "2026-07-08T00:00:00Z" },
        extra_usage: {
          is_enabled: true,
          monthly_limit: 15000,
          used_credits: 3000,
          utilization: 20,
        },
      }),
    );
    const summary = buildClaudeUsageSummary(payload);

    expect(summary).toMatchObject({
      fiveHourUsedPercent: 35,
      sevenDayUsedPercent: 60,
    });
    expect(summary?.windows).toHaveLength(2);
    expect(summary?.extraUsage).toMatchObject({
      isEnabled: true,
      monthlyLimitCents: 15000,
      usedCredits: 3000,
    });

    expect(claudeUsageToQuotaPercents(summary!)).toEqual({
      usage5hPercent: 35,
      usageWeekPercent: 60,
      available: true,
    });
  });

  it("marks accounts exhausted when a window is fully used", () => {
    const summary = buildClaudeUsageSummary({
      five_hour: { utilization: 100, resets_at: "2026-07-01T05:00:00Z" },
      seven_day: { utilization: 80, resets_at: "2026-07-08T00:00:00Z" },
    });
    expect(claudeUsageToQuotaPercents(summary!)).toEqual({
      usage5hPercent: 100,
      usageWeekPercent: 80,
      available: false,
    });
  });

  it("returns null when there are no usage windows", () => {
    expect(buildClaudeUsageSummary({})).toBeNull();
  });

  it("resolves plan labels from the profile payload", () => {
    expect(
      resolveClaudePlanLabel({ account: { has_claude_max: true } }),
    ).toBe("Max");
    expect(
      resolveClaudePlanLabel({ account: { has_claude_pro: true } }),
    ).toBe("Pro");
    expect(
      resolveClaudePlanLabel({
        account: { has_claude_max: false, has_claude_pro: false },
        organization: {
          organization_type: "claude_team",
          subscription_status: "active",
        },
      }),
    ).toBe("Team");
    expect(
      resolveClaudePlanLabel({
        account: { has_claude_max: false, has_claude_pro: false },
      }),
    ).toBe("Free");
  });
});
