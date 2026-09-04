const SENSITIVE_KEY_NAMES = [
  "authorization",
  "apiKey",
  "card6Digits",
  "cardSuffix",
  "email",
  "id",
  "KodMishtamesh",
  "MisparZihuy",
  "nationalID",
  "num",
  "otpCode",
  "otpLongTermToken",
  "pass",
  "password",
  "phoneNumber",
  "Sisma",
  "token",
  "userCode",
  "username",
];

const SENSITIVE_KEYS = SENSITIVE_KEY_NAMES.join("|");
const JSON_DOUBLE_QUOTED_VALUE = new RegExp(
  `("(?:${SENSITIVE_KEYS})"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`,
  "gi"
);
const JSON_SINGLE_QUOTED_VALUE = new RegExp(
  `('(?:${SENSITIVE_KEYS})'\\s*:\\s*)'(?:\\\\.|[^'\\\\])*'`,
  "gi"
);
const UNQUOTED_SENSITIVE_VALUE = new RegExp(
  `\\b(${SENSITIVE_KEYS})\\b\\s*([=:])\\s*[^\\s,;&}\\]]+`,
  "gi"
);

/** Remove credentials and common financial identifiers from error text. */
export function sanitizeSensitiveText(value: unknown): string {
  let text: string;
  if (value instanceof Error) {
    text = value.message;
  } else if (typeof value === "string") {
    text = value;
  } else {
    return "An unknown error occurred";
  }

  return text
    .replace(JSON_DOUBLE_QUOTED_VALUE, '$1"[REDACTED]"')
    .replace(JSON_SINGLE_QUOTED_VALUE, "$1'[REDACTED]'")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(UNQUOTED_SENSITIVE_VALUE, "$1$2[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\b\d{5,}\b/g, "[REDACTED]");
}
