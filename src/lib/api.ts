import { migrate } from "@/db/migrate";
import { isAuthenticatedRequest } from "./auth";

export function initRequestDb() {
  migrate();
}

export function ok<T>(data: T, init?: ResponseInit) {
  return Response.json(data, init);
}

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export function conflict(message: string) {
  return Response.json({ error: message }, { status: 409 });
}

export function unauthorized(message = "unauthorized") {
  return Response.json({ error: message }, { status: 401 });
}

export function notFound(message = "not found") {
  return Response.json({ error: message }, { status: 404 });
}

export function requireAuth(request: Request) {
  return isAuthenticatedRequest(request) ? null : unauthorized();
}

export function serverError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

export async function routeParams<T extends Record<string, string>>(
  context: { params: Promise<T> } | { params: T },
) {
  return await context.params;
}

export function parseIntegerId(raw: string) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
