import { db } from "@/db/client";
import { candidateAuthFiles } from "@/db/schema";

import { expandCpaAuthJsonFile, type CpaAuthJsonUploadResult } from "./cpa-auth-json";

export type CandidateAuthImportResult = {
  uploaded: number;
  failed: number;
  results: CpaAuthJsonUploadResult[];
};

export function importCandidateAuthFiles(
  files: unknown[],
  options: { now?: Date } = {},
): CandidateAuthImportResult {
  const now = (options.now ?? new Date()).toISOString();
  const results: CpaAuthJsonUploadResult[] = [];

  for (const file of files) {
    const expandedFiles = expandCpaAuthJsonFile(file);
    for (const expanded of expandedFiles) {
      if (expanded.kind === "error") {
        results.push(expanded.result);
        continue;
      }

      const normalized = expanded.file;
      try {
        db.insert(candidateAuthFiles)
          .values({
            fileName: normalized.fileName,
            email: normalized.email,
            provider: normalized.provider,
            available: true,
            status: "待刷新",
            statusMessage: null,
            rawJson: JSON.stringify(normalized.payload),
            quotaRawJson: null,
            usage5hPercent: null,
            usageWeekPercent: null,
            lastQuotaRefreshedAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: candidateAuthFiles.fileName,
            set: {
              email: normalized.email,
              provider: normalized.provider,
              available: true,
              status: "待刷新",
              statusMessage: null,
              rawJson: JSON.stringify(normalized.payload),
              quotaRawJson: null,
              usage5hPercent: null,
              usageWeekPercent: null,
              lastQuotaRefreshedAt: null,
              updatedAt: now,
            },
          })
          .run();

        results.push({
          fileName: normalized.fileName,
          email: normalized.email,
          status: "success",
        });
      } catch (error) {
        results.push({
          fileName: normalized.fileName,
          email: normalized.email,
          status: "error",
          error: errorMessage(error),
        });
      }
    }
  }

  const uploaded = results.filter((result) => result.status === "success").length;
  return {
    uploaded,
    failed: results.length - uploaded,
    results,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
