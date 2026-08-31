import type { CategoryMapping } from "./types";

function parseConfidence(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return undefined;
  const clamped = Math.round(n);
  if (clamped < 1 || clamped > 7) return undefined;
  return clamped;
}

function parseJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {
        // Fall through and try a wrapped/keyed object.
      }
    }
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function mappingCandidates(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== "object" || payload === null) return [];

  const record = payload as Record<string, unknown>;
  for (const key of ["assignments", "mappings", "results", "categories"]) {
    if (Array.isArray(record[key])) return record[key];
  }

  // Small local models sometimes return {"0": {...}, "1": {...}} despite
  // an explicit array prompt. Preserve the numeric key as a fallback index.
  return Object.entries(record).map(([key, value]) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return value;
    }
    const item = value as Record<string, unknown>;
    return item.index == null && /^\d+$/.test(key)
      ? { ...item, index: Number(key) }
      : item;
  });
}

export function parseCategoryResponse(
  text: string,
  validCategories: string[],
  allowProposals: boolean,
  transactionCount: number
): CategoryMapping[] {
  const candidates = mappingCandidates(parseJsonPayload(text));
  const validSet = new Set(validCategories.map((c) => c.toLowerCase()));
  const seen = new Set<number>();
  const results: CategoryMapping[] = [];

  for (const item of candidates) {
    if (typeof item !== "object" || item === null) continue;
    const typed = item as Record<string, unknown>;
    if (
      typeof typed.index !== "number" ||
      !Number.isInteger(typed.index) ||
      typed.index < 0 ||
      typed.index >= transactionCount ||
      seen.has(typed.index) ||
      typeof typed.categoryName !== "string"
    ) {
      continue;
    }

    const name = typed.categoryName.trim();
    if (!name) continue;
    const isExisting = validSet.has(name.toLowerCase());
    if (!isExisting && !allowProposals) continue;

    seen.add(typed.index);
    results.push({
      index: typed.index,
      categoryName: name,
      isNew: !isExisting,
      confidence: parseConfidence(typed.confidence),
    });
  }

  return results;
}

