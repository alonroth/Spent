import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/server/db/queries/settings";
import { encrypt } from "@/server/lib/encryption";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    provider: "claude" | "gemini" | "ollama" | "none";
    apiKey?: string;
    ollamaUrl?: string;
    ollamaModel?: string;
    geminiModel?: "gemini-3.7-flash" | "gemini-3.5-flash-lite";
  };

  if (!["claude", "gemini", "ollama", "none"].includes(body.provider)) {
    return NextResponse.json({ error: "Unsupported AI provider" }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();

  if (body.provider === "claude" && apiKey) {
    const { encrypted, iv, authTag } = encrypt(apiKey);
    setSetting("ai_api_key_encrypted", encrypted.toString("hex"));
    setSetting("ai_api_key_iv", iv.toString("hex"));
    setSetting("ai_api_key_auth_tag", authTag.toString("hex"));
  }

  if (body.provider === "gemini") {
    if (body.geminiModel && !["gemini-3.7-flash", "gemini-3.5-flash-lite"].includes(body.geminiModel)) {
      return NextResponse.json({ error: "Unsupported Gemini model" }, { status: 400 });
    }
    if (apiKey) {
      const { encrypted, iv, authTag } = encrypt(apiKey);
      setSetting("ai_gemini_api_key_encrypted", encrypted.toString("hex"));
      setSetting("ai_gemini_api_key_iv", iv.toString("hex"));
      setSetting("ai_gemini_api_key_auth_tag", authTag.toString("hex"));
    }
    if (!apiKey && (!getSetting("ai_gemini_api_key_encrypted") || !getSetting("ai_gemini_api_key_iv") || !getSetting("ai_gemini_api_key_auth_tag"))) {
      return NextResponse.json({ error: "A Gemini API key is required" }, { status: 400 });
    }
    if (body.geminiModel) setSetting("ai_gemini_model", body.geminiModel);
  }

  if (body.provider === "ollama") {
    if (body.ollamaUrl) setSetting("ai_ollama_url", body.ollamaUrl);
    if (body.ollamaModel) setSetting("ai_ollama_model", body.ollamaModel);
  }

  setSetting("ai_provider", body.provider);

  return NextResponse.json({ success: true });
}
