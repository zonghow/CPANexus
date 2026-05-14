import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { CpaDashboard, type SectionId } from "@/components/cpa-dashboard";
import { LoginPage } from "@/components/login-page";
import { isAuthenticatedCookieHeader } from "@/lib/auth";

const sections = new Set<SectionId>([
  "instances",
  "auth",
  "strategies",
  "replenishment-records",
  "proxies",
  "jobs",
  "backups",
]);

export default async function DashboardSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (section === "quotas") {
    redirect("/auth");
  }

  if (!sections.has(section as SectionId)) {
    notFound();
  }

  const cookieHeader = (await headers()).get("cookie");
  if (!isAuthenticatedCookieHeader(cookieHeader)) {
    return <LoginPage />;
  }

  return <CpaDashboard section={section as SectionId} />;
}
