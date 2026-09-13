export type PeriodState =
  | { mode: "month"; month: string }
  | { mode: "range"; from: string; to: string };

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function isMonth(value: string | null): value is string {
  return value !== null && MONTH_PATTERN.test(value);
}

export function readPeriod(params: URLSearchParams): PeriodState {
  const from = params.get("from");
  const to = params.get("to");
  if (isMonth(from) && isMonth(to) && from <= to) {
    return { mode: "range", from, to };
  }
  const month = params.get("month");
  return { mode: "month", month: isMonth(month) ? month : currentMonth() };
}

export function readEnum<T extends string>(
  params: URLSearchParams,
  key: string,
  values: readonly T[],
  fallback: T,
): T {
  const value = params.get(key);
  return value !== null && values.includes(value as T) ? (value as T) : fallback;
}

export function readPositiveIntegers(params: URLSearchParams, key: string): number[] {
  return [...new Set(params.getAll(key).map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))];
}

export function readPositiveInteger(
  params: URLSearchParams,
  key: string,
  fallback: number,
): number {
  const value = Number(params.get(key));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function readStrings(params: URLSearchParams, key: string): string[] {
  return [...new Set(params.getAll(key).filter(Boolean))];
}
