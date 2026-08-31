import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import pkg from "../../../../package.json";
import { getRemoteAccessStatus } from "@/server/remote-access";

const DB_PATH = path.join(process.cwd(), "data", "spent.db");

export const dynamic = "force-dynamic";

export function GET() {
  const remoteAccess = getRemoteAccessStatus();
  return NextResponse.json({
    ok: true,
    version: pkg.version,
    hasDb: fs.existsSync(DB_PATH),
    remoteAccessEnabled: remoteAccess.enabled,
    remoteAccessRunning: remoteAccess.running,
  });
}
