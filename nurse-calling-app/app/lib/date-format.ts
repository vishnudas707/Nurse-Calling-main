/**
 * One date format across the whole app: dd-mm-yyyy.
 *
 * `toLocaleString()` follows whatever locale the browser happens to be set to,
 * so the same call row reads 09/05/2026 on one machine and 05/09/2026 on the
 * next - ambiguous in exactly the place a nurse call log cannot afford it.
 * These helpers build the string by hand so every screen, CSV and PDF agrees.
 */

function parse(value: string | Date | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "05-09-2026" - local calendar day. */
export function formatDate(value: string | Date | number | null | undefined): string {
  const date = parse(value);
  if (!date) return "";
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

/** "05-09-2026 03:04:05 PM" - the day plus a 12-hour clock, as the tables show it. */
export function formatDateTime(value: string | Date | number | null | undefined): string {
  const date = parse(value);
  if (!date) return "";
  const hours = date.getHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const suffix = hours < 12 ? "AM" : "PM";
  const time = `${pad(hour12)}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${suffix}`;
  return `${formatDate(date)} ${time}`;
}

/**
 * "2026-09-05" -> "05-09-2026". Day keys stay ISO internally because grouping
 * and sorting lean on them ordering lexicographically; only the display flips.
 */
export function formatDayKey(key: string | null | undefined): string {
  if (!key) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!match) return key;
  const [, y, m, d] = match;
  return `${d}-${m}-${y}`;
}
