import { NextResponse } from "next/server";
import {
  getAppSettings,
  updateAppSettings,
} from "@/server/db/queries/settings";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { LOCALE_COOKIE } from "@/i18n/routing";
import { configureRemoteAccess, getRemoteAccessStatus } from "@/server/remote-access";

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  return NextResponse.json({
    ...getAppSettings(workspaceId),
    remoteAccess: getRemoteAccessStatus(),
  });
}

export async function PUT(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = await request.json() as Record<string, unknown>;
  try {
    const {
      remoteAccessEnabled,
      remoteAccessPassword,
      remoteAccessPasswordConfirmation,
      ...appSettingsBody
    } = body;
    const updated = updateAppSettings(workspaceId, appSettingsBody);
    if (remoteAccessEnabled !== undefined) {
      await configureRemoteAccess({
        enabled: remoteAccessEnabled === true,
        password: typeof remoteAccessPassword === "string" ? remoteAccessPassword : undefined,
        passwordConfirmation:
          typeof remoteAccessPasswordConfirmation === "string"
            ? remoteAccessPasswordConfirmation
            : undefined,
      });
    }
    if (body.autoSyncEnabled !== undefined || body.autoSyncTime !== undefined) {
      const { reschedule } = await import("@/server/sync/scheduler");
      reschedule();
    }
    const res = NextResponse.json({
      ...updated,
      remoteAccess: getRemoteAccessStatus(),
    });
    if (body.language === "en" || body.language === "he") {
      res.cookies.set(LOCALE_COOKIE, body.language, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update settings";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
