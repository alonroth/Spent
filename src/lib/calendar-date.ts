const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

const jerusalemDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Return the calendar date represented by a transaction timestamp in Israel.
 *
 * Bank scrapers serialize Israeli midnight as a UTC instant. For example,
 * September 1 during daylight-saving time is stored as August 31 at 21:00Z.
 * Date-only values (manual, recurring, and deployment transactions) are already
 * calendar dates and must not be shifted.
 */
export function transactionCalendarDate(value: string): string {
  if (ISO_DATE_ONLY.test(value)) return value;

  const instant = new Date(value);
  if (!Number.isNaN(instant.getTime())) {
    const parts = jerusalemDateFormatter.formatToParts(instant);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  }

  // Preserve the old behavior for an unexpected non-ISO value. Validation at
  // the API boundary should prevent this, but a readable prefix is safer than
  // turning one malformed historical row into a failed page request.
  return value.match(ISO_DATE_PREFIX)?.[0] ?? value;
}

/** Parse a YYYY-MM-DD value without letting JavaScript interpret it as UTC. */
export function parseCalendarDate(value: string): Date {
  const normalized = transactionCalendarDate(value);
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(year, month - 1, day);
}
