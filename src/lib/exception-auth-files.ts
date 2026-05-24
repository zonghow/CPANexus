import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import {
  authFiles,
  cpaInstances,
  exceptionAuthFiles,
  quotaSnapshots,
  type AuthFile,
  type CpaInstance,
  type ExceptionAuthFile,
} from "@/db/schema";
import {
  deleteRemoteAuthFile,
  downloadRemoteAuthFile,
  uploadRemoteAuthFile,
} from "@/lib/cpa-client";

export function exceptionAuthFilesToEmailCsv(rows: Array<{ email: string | null }>) {
  const lines = rows
    .map((row) => row.email?.trim() ?? "")
    .filter((email) => email.length > 0)
    .map(csvCell);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function stringifyStoredAuthPayload(payload: unknown) {
  const text = JSON.stringify(payload);
  if (!text) {
    throw new Error("auth file payload is unavailable");
  }
  return text;
}

export function parseStoredAuthPayload(rawJson: string) {
  try {
    return JSON.parse(rawJson) as unknown;
  } catch {
    throw new Error("stored auth payload is invalid");
  }
}

export async function portalAuthFileToExceptionPool(
  instance: CpaInstance,
  authFile: AuthFile,
) {
  const payload = await loadAuthPayloadForPortal(instance, authFile);
  const now = new Date().toISOString();
  const lastError = authFile.statusMessage ?? authFile.status ?? null;
  const rawJson = stringifyStoredAuthPayload(payload);

  db.insert(exceptionAuthFiles)
    .values({
      sourceCpaInstanceId: instance.id,
      sourceCpaInstanceName: instance.name,
      fileName: authFile.fileName,
      email: authFile.email,
      lastError,
      rawJson,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: exceptionAuthFiles.fileName,
      set: {
        sourceCpaInstanceId: instance.id,
        sourceCpaInstanceName: instance.name,
        email: authFile.email,
        lastError,
        rawJson,
        updatedAt: now,
      },
    })
    .run();

  await deleteRemoteAuthFile(instance, authFile.fileName);
  deleteLocalAuthFile(authFile.cpaInstanceId, authFile.id, authFile.fileName);
}

export async function moveExceptionAuthFileToCpa(
  row: ExceptionAuthFile,
  targetInstance: CpaInstance,
) {
  const duplicate = db
    .select()
    .from(authFiles)
    .where(
      and(
        eq(authFiles.cpaInstanceId, targetInstance.id),
        eq(authFiles.fileName, row.fileName),
      ),
    )
    .get();
  if (duplicate) {
    throw new Error(`target CPA already has auth file ${row.fileName}`);
  }

  await uploadRemoteAuthFile(targetInstance, row.fileName, parseStoredAuthPayload(row.rawJson));
  db.delete(exceptionAuthFiles).where(eq(exceptionAuthFiles.id, row.id)).run();
}

export function deleteLocalAuthFile(
  cpaInstanceId: number,
  authFileId: number,
  fileName: string,
) {
  db.delete(quotaSnapshots)
    .where(
      and(
        eq(quotaSnapshots.cpaInstanceId, cpaInstanceId),
        eq(quotaSnapshots.authFileName, fileName),
      ),
    )
    .run();
  db.delete(authFiles).where(eq(authFiles.id, authFileId)).run();
}

export function loadExceptionAuthFile(id: number) {
  return db.select().from(exceptionAuthFiles).where(eq(exceptionAuthFiles.id, id)).get() ?? null;
}

export function loadTargetCpaInstance(targetCpaInstanceId: number) {
  return db.select().from(cpaInstances).where(eq(cpaInstances.id, targetCpaInstanceId)).get() ?? null;
}

async function loadAuthPayloadForPortal(instance: CpaInstance, authFile: AuthFile) {
  try {
    return await downloadRemoteAuthFile(instance, authFile.fileName);
  } catch {
    if (!authFile.rawJson) {
      throw new Error("auth file payload is unavailable");
    }
    return parseStoredAuthPayload(authFile.rawJson);
  }
}

function csvCell(value: string) {
  return /[",\n\r]/.test(value)
    ? `"${value.replaceAll("\"", "\"\"")}"`
    : value;
}
