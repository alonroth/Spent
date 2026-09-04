import { NextResponse } from "next/server";
import {
  defaultLabelForProvider,
  getBankCredentials,
  getBankCredentialMeta,
  saveBankCredentials,
} from "@/server/db/queries/bank-credentials";
import { BANK_PROVIDERS } from "@/lib/types";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json()) as {
    provider: string;
    credentials: Record<string, string>;
    label?: string;
    credentialId?: number;
    requiresManualTwoFactor?: boolean;
  };

  if (
    !body.provider ||
    !body.credentials ||
    typeof body.credentials !== "object" ||
    Array.isArray(body.credentials)
  ) {
    return NextResponse.json(
      { success: false, message: "Missing provider or credentials" },
      { status: 400 }
    );
  }

  const info = BANK_PROVIDERS.find((b) => b.id === body.provider);
  if (!info) {
    return NextResponse.json(
      { success: false, message: "Unsupported provider" },
      { status: 400 }
    );
  }

  const credentialId = body.credentialId;
  const existingMeta =
    credentialId != null
      ? getBankCredentialMeta(workspaceId, credentialId)
      : null;
  if (credentialId != null) {
    if (!existingMeta) {
      return NextResponse.json(
        { success: false, message: "Credential not found" },
        { status: 404 }
      );
    }
    if (existingMeta.provider !== body.provider) {
      return NextResponse.json(
        { success: false, message: "Credential provider mismatch" },
        { status: 400 }
      );
    }
  }

  const existing = existingMeta
    ? getBankCredentials(workspaceId, existingMeta.id)
    : null;
  const merged: Record<string, string> = {};

  // Every credential field is write-only. On edit, an omitted/blank field
  // retains its encrypted saved value; only explicit non-empty replacements
  // are written.
  for (const field of info.credentialFields) {
    const supplied = body.credentials[field.key];
    if (typeof supplied === "string" && supplied.trim() !== "") {
      merged[field.key] = supplied;
    } else if (existing?.[field.key]) {
      merged[field.key] = existing[field.key];
    } else {
      return NextResponse.json(
        { success: false, message: `Missing required field: ${field.key}` },
        { status: 400 }
      );
    }
  }

  if (existing?.otpLongTermToken && !merged.otpLongTermToken) {
    merged.otpLongTermToken = existing.otpLongTermToken;
  }

  const label =
    body.label?.trim() ||
    existingMeta?.label ||
    defaultLabelForProvider(workspaceId, body.provider);

  try {
    const id = saveBankCredentials(workspaceId, body.provider, merged, {
      credentialId,
      label,
      requiresManualTwoFactor: body.requiresManualTwoFactor,
    });
    return NextResponse.json({ success: true, credentialId: id });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save credentials";
    if (/UNIQUE constraint/i.test(message)) {
      return NextResponse.json(
        {
          success: false,
          message: "An account with this label already exists for this bank.",
        },
        { status: 409 }
      );
    }
    throw err;
  }
}
