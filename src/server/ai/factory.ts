import "server-only";

import type { AIProvider } from "./types";
import { ClaudeProvider } from "./providers/claude";
import { OllamaProvider } from "./providers/ollama";
import { GeminiProvider } from "./providers/gemini";
import { getSetting } from "../db/queries/settings";
import { decrypt } from "../lib/encryption";

export function createAIProvider(): AIProvider | null {
  const provider = getSetting("ai_provider");

  if (provider === "claude") {
    const encryptedKey = getSetting("ai_api_key_encrypted");
    const iv = getSetting("ai_api_key_iv");
    const authTag = getSetting("ai_api_key_auth_tag");

    if (!encryptedKey || !iv || !authTag) return null;

    const apiKey = decrypt({
      encrypted: Buffer.from(encryptedKey, "hex"),
      iv: Buffer.from(iv, "hex"),
      authTag: Buffer.from(authTag, "hex"),
    });

    return new ClaudeProvider(apiKey);
  }

  if (provider === "ollama") {
    const url = getSetting("ai_ollama_url") ?? "http://localhost:11434";
    const model = getSetting("ai_ollama_model") ?? "llama3.1";
    return new OllamaProvider(url, model);
  }

  if (provider === "gemini") {
    const encryptedKey = getSetting("ai_gemini_api_key_encrypted");
    const iv = getSetting("ai_gemini_api_key_iv");
    const authTag = getSetting("ai_gemini_api_key_auth_tag");
    if (!encryptedKey || !iv || !authTag) return null;

    const apiKey = decrypt({
      encrypted: Buffer.from(encryptedKey, "hex"),
      iv: Buffer.from(iv, "hex"),
      authTag: Buffer.from(authTag, "hex"),
    });
    const model = getSetting("ai_gemini_model") ?? "gemini-3.7-flash";
    return new GeminiProvider(apiKey, model as "gemini-3.7-flash" | "gemini-3.5-flash-lite");
  }

  return null;
}
